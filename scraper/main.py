"""
FastAPI 서버 + APScheduler
- Betman 크롤링 스케줄
- API-Football 데이터 수집
- The Odds API 배당 폴링
"""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger
from supabase import create_client, Client

from betman.scraper import BetmanScraper
from collectors.api_football import APIFootballClient
from collectors.odds_api import OddsAPIClient

load_dotenv()

SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY  = os.getenv("SUPABASE_SERVICE_KEY", "")
API_FB_KEY    = os.getenv("API_FOOTBALL_KEY", "")
ODDS_API_KEY  = os.getenv("ODDS_API_KEY", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
scheduler = AsyncIOScheduler(timezone="Asia/Seoul")


# ── 팀 ID 조회 (alias 매핑) ────────────────────────────
def find_or_create_team(name_kr: str, league_id: str | None = None) -> str | None:
    """팀명으로 team_id 조회, 없으면 임시 생성"""
    # alias 테이블에서 검색
    res = supabase.table("team_aliases").select("team_id").eq("alias", name_kr).limit(1).execute()
    if res.data:
        return res.data[0]["team_id"]

    # 팀 테이블에서 직접 검색
    res2 = supabase.table("teams").select("id").eq("name_kr", name_kr).limit(1).execute()
    if res2.data:
        team_id = res2.data[0]["id"]
        # alias에 등록
        supabase.table("team_aliases").upsert({"team_id": team_id, "alias": name_kr, "source": "betman"}).execute()
        return team_id

    # 팀이 없으면 새로 생성
    new_team = supabase.table("teams").insert({
        "name_kr": name_kr,
        "name_en": name_kr,  # 임시로 한글 그대로
        "league_id": league_id,
    }).execute()
    if new_team.data:
        team_id = new_team.data[0]["id"]
        supabase.table("team_aliases").insert({"team_id": team_id, "alias": name_kr, "source": "betman"}).execute()
        return team_id

    return None


def find_or_create_league(league_name: str) -> str | None:
    """리그 ID 조회, 없으면 생성"""
    res = supabase.table("leagues").select("id").eq("name_kr", league_name).limit(1).execute()
    if res.data:
        return res.data[0]["id"]

    # 축구 sport_id 조회
    sport = supabase.table("sports").select("id").eq("name_en", "soccer").limit(1).execute()
    sport_id = sport.data[0]["id"] if sport.data else None

    new_league = supabase.table("leagues").insert({
        "name_kr": league_name,
        "name_en": league_name,
        "sport_id": sport_id,
    }).execute()
    return new_league.data[0]["id"] if new_league.data else None


# ── 스케줄 태스크 ──────────────────────────────────────

async def job_betman_schedule():
    """배트맨 경기 일정 수집"""
    logger.info("▶ 배트맨 경기 일정 크롤링 시작")
    import time
    start = time.time()
    inserted = 0

    try:
        async with BetmanScraper() as scraper:
            matches = await scraper.fetch_proto_schedule()

        logger.info(f"크롤링 결과: {len(matches)}경기")

        for m in matches:
            home_kr = m.get("home_name_kr", "").strip()
            away_kr = m.get("away_name_kr", "").strip()
            league_kr = m.get("league_name", "기타")

            if not home_kr or not away_kr:
                continue

            # 리그/팀 ID 자동 생성
            league_id  = find_or_create_league(league_kr)
            home_id    = find_or_create_team(home_kr, league_id)
            away_id    = find_or_create_team(away_kr, league_id)

            if not home_id or not away_id:
                logger.warning(f"팀 ID 생성 실패: {home_kr} vs {away_kr}")
                continue

            betman_id = f"{m.get('betman_round','')}-{m.get('betman_game_no','')}"

            # matches 테이블 upsert
            row = {
                "betman_id":       betman_id,
                "betman_round":    m.get("betman_round"),
                "betman_game_no":  m.get("betman_game_no"),
                "league_id":       league_id,
                "home_team_id":    home_id,
                "away_team_id":    away_id,
                "match_date":      m.get("match_date"),
                "status":          "scheduled",
                "mapping_status":  "matched",
            }
            result = supabase.table("matches").upsert(row, on_conflict="betman_id").execute()

            # 배당 저장
            if result.data and (m.get("home_odds") or m.get("draw_odds") or m.get("away_odds")):
                match_id = result.data[0]["id"]
                supabase.table("odds_history").insert({
                    "match_id":   match_id,
                    "provider":   "betman",
                    "home_odds":  m.get("home_odds"),
                    "draw_odds":  m.get("draw_odds"),
                    "away_odds":  m.get("away_odds"),
                }).execute()

            inserted += 1

        duration = int((time.time() - start) * 1000)
        supabase.table("scrape_logs").insert({
            "source": "betman", "job_type": "schedule",
            "status": "success", "records": inserted, "duration_ms": duration,
        }).execute()
        logger.info(f"✓ 배트맨 {inserted}경기 저장 완료 ({duration}ms)")

    except Exception as e:
        logger.error(f"✗ 배트맨 크롤링 실패: {e}")
        supabase.table("scrape_logs").insert({
            "source": "betman", "job_type": "schedule",
            "status": "error", "error_msg": str(e),
        }).execute()
        raise


async def job_odds_polling():
    """배당 5분 폴링"""
    logger.info("▶ 배당 폴링 시작")
    if not ODDS_API_KEY:
        logger.warning("ODDS_API_KEY 미설정 — 건너뜀")
        return
    try:
        async with OddsAPIClient(ODDS_API_KEY) as client:
            all_odds = await client.get_all_sports_odds()
        logger.info(f"✓ 배당 {len(all_odds)}건 수집")
    except Exception as e:
        logger.error(f"✗ 배당 폴링 실패: {e}")


async def job_injuries():
    """결장자 수집"""
    logger.info("▶ 결장자 데이터 수집 시작")
    if not API_FB_KEY:
        logger.warning("API_FOOTBALL_KEY 미설정 — 건너뜀")
        return


# ── FastAPI 앱 ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(job_betman_schedule, CronTrigger(hour="9,15", minute="0"), id="betman_schedule")
    scheduler.add_job(job_odds_polling,    IntervalTrigger(minutes=5),            id="odds_polling")
    scheduler.add_job(job_injuries,        CronTrigger(hour="8", minute="0"),     id="injuries")
    scheduler.start()
    logger.info("스케줄러 시작 ✓")
    yield
    scheduler.shutdown()

app = FastAPI(title="스포츠 분석기 Scraper API", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "scheduler_running": scheduler.running}


@app.post("/trigger/betman")
async def trigger_betman():
    """수동 배트맨 크롤링 트리거"""
    try:
        await job_betman_schedule()
        return {"message": "배트맨 크롤링 완료"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/debug/betman")
async def debug_betman():
    """배트맨 페이지 HTML 구조 디버깅 — 셀렉터 개발용"""
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        await page.goto(
            "https://www.betman.co.kr/",
            wait_until="networkidle", timeout=30_000
        )
        await page.wait_for_timeout(3000)

        # 페이지 텍스트 추출
        text = await page.inner_text("body")
        # 주요 테이블/리스트 클래스 수집
        tables = await page.evaluate("""() => {
            const els = document.querySelectorAll('table, ul, [class*="list"], [class*="game"], [class*="match"]');
            return Array.from(els).slice(0, 20).map(el => ({
                tag: el.tagName,
                cls: el.className,
                text: el.innerText?.slice(0, 100)
            }));
        }""")
        await browser.close()
    return {"page_text_sample": text[:2000], "elements": tables}


@app.post("/trigger/odds")
async def trigger_odds():
    await job_odds_polling()
    return {"message": "배당 수집 완료"}


@app.post("/trigger/injuries")
async def trigger_injuries():
    await job_injuries()
    return {"message": "결장자 수집 완료"}


@app.get("/logs")
async def get_logs(limit: int = 20):
    result = supabase.table("scrape_logs").select("*").order("created_at", desc=True).limit(limit).execute()
    return result.data


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

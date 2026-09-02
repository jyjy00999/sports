"""
배트맨(betman.co.kr) 크롤러
- 프로토 발매 대상 경기 일정 + 국내 배당 수집
- Playwright 사용 (JavaScript 렌더링 필요)
"""

import asyncio
import os
import re
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from loguru import logger
from playwright.async_api import async_playwright, Page, Browser
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

BETMAN_LOGIN_URL = "https://www.betman.co.kr/main/mainPage/member/memberLogin.do"
BETMAN_PROTO_URL = "https://www.betman.co.kr/main/mainPage/protoSoccer/protoSoccerList.do"
BETMAN_TOTO_URL  = "https://www.betman.co.kr/main/mainPage/sportsProto/sportsProtoList.do"


class BetmanScraper:
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.betman_id = os.getenv("BETMAN_ID", "")
        self.betman_pw = os.getenv("BETMAN_PW", "")

    async def __aenter__(self):
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        return self

    async def __aexit__(self, *_):
        if self.browser:
            await self.browser.close()
        await self._pw.stop()

    async def login(self, page) -> bool:
        """배트맨 로그인"""
        if not self.betman_id or not self.betman_pw:
            logger.warning("BETMAN_ID / BETMAN_PW 미설정")
            return False
        try:
            logger.info("배트맨 로그인 시도...")
            await page.goto(BETMAN_LOGIN_URL, wait_until="networkidle", timeout=20_000)
            await page.wait_for_timeout(1000)

            # 아이디/비밀번호 입력 (셀렉터는 실제 사이트 구조에 따라 조정)
            id_input = await page.query_selector("input[name='memberId'], input[id='memberId'], input[type='text']")
            pw_input = await page.query_selector("input[name='memberPwd'], input[id='memberPwd'], input[type='password']")

            if not id_input or not pw_input:
                logger.error("로그인 폼을 찾을 수 없음")
                return False

            await id_input.fill(self.betman_id)
            await pw_input.fill(self.betman_pw)

            # 로그인 버튼 클릭
            login_btn = await page.query_selector("button[type='submit'], input[type='submit'], .btn-login, .loginBtn")
            if login_btn:
                await login_btn.click()
            else:
                await pw_input.press("Enter")

            await page.wait_for_timeout(2000)
            # 로그인 성공 확인 (URL 변경 or 특정 요소 존재)
            current_url = page.url
            logger.info(f"로그인 후 URL: {current_url}")
            return "login" not in current_url.lower()

        except Exception as e:
            logger.error(f"로그인 실패: {e}")
            return False

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
    async def fetch_proto_schedule(self) -> list[dict]:
        """프로토 발매 경기 목록 수집"""
        page = await self.browser.new_page()
        results = []

        try:
            # 로그인 먼저
            logged_in = await self.login(page)
            if not logged_in:
                logger.warning("로그인 실패 또는 미설정 — 비로그인으로 시도")

            logger.info("Betman 프로토 페이지 로딩...")
            await page.goto(BETMAN_PROTO_URL, wait_until="networkidle", timeout=30_000)
            await page.wait_for_timeout(2000)

            # 회차 정보 추출
            round_text = await page.text_content(".gameRound, .round-info, [class*='round']") or ""
            round_info = round_text.strip()
            logger.info(f"회차: {round_info}")

            # 경기 목록 파싱 — 사이트 구조에 맞게 셀렉터 조정 필요
            rows = await page.query_selector_all("table.gameList tr, .match-list .match-item")

            for i, row in enumerate(rows):
                try:
                    game_data = await self._parse_proto_row(row, round_info, i + 1)
                    if game_data:
                        results.append(game_data)
                except Exception as e:
                    logger.warning(f"경기 {i+1} 파싱 오류: {e}")
                    continue

            logger.info(f"총 {len(results)}경기 수집 완료")
            return results

        except Exception as e:
            logger.error(f"Betman 크롤링 오류: {e}")
            raise
        finally:
            await page.close()

    async def _parse_proto_row(self, row, round_info: str, game_no: int) -> Optional[dict]:
        """개별 경기 행 파싱"""
        text = await row.text_content() or ""
        if not text.strip():
            return None

        # 배당률 추출 (숫자 패턴)
        odds_pattern = re.findall(r'\d+\.\d{2}', text)

        # 팀명 추출 — 실제 HTML 구조에 따라 셀렉터 수정 필요
        home_el = await row.query_selector(".home-team, .teamHome, td:nth-child(2)")
        away_el = await row.query_selector(".away-team, .teamAway, td:nth-child(4)")
        date_el = await row.query_selector(".match-date, .gameDate, td:nth-child(1)")

        home_name = (await home_el.text_content() if home_el else "").strip()
        away_name = (await away_el.text_content() if away_el else "").strip()
        date_text = (await date_el.text_content() if date_el else "").strip()

        if not home_name or not away_name:
            return None

        # 배당 파싱
        home_odds = float(odds_pattern[0]) if len(odds_pattern) > 0 else None
        draw_odds = float(odds_pattern[1]) if len(odds_pattern) > 1 else None
        away_odds = float(odds_pattern[2]) if len(odds_pattern) > 2 else None

        # 날짜 파싱 (형식: "09/01 19:00" 등)
        match_date = self._parse_date(date_text)

        return {
            "betman_round":   round_info,
            "betman_game_no": game_no,
            "home_name_kr":   home_name,
            "away_name_kr":   away_name,
            "match_date_raw": date_text,
            "match_date":     match_date,
            "home_odds":      home_odds,
            "draw_odds":      draw_odds,
            "away_odds":      away_odds,
            "scraped_at":     datetime.utcnow().isoformat(),
        }

    def _parse_date(self, text: str) -> Optional[str]:
        """날짜 문자열을 ISO 포맷으로 변환"""
        patterns = [
            r'(\d{2}/\d{2})\s+(\d{2}:\d{2})',   # 09/01 19:00
            r'(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})',
        ]
        year = datetime.now().year
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                try:
                    if '/' in m.group(1):
                        month, day = m.group(1).split('/')
                        time = m.group(2)
                        return f"{year}-{month}-{day}T{time}:00+09:00"
                    else:
                        return f"{m.group(1)}T{m.group(2)}:00+09:00"
                except Exception:
                    pass
        return None


# ── 실행 테스트 ──
async def main():
    async with BetmanScraper() as scraper:
        schedule = await scraper.fetch_proto_schedule()
        for match in schedule:
            print(f"[{match['betman_game_no']}] "
                  f"{match['home_name_kr']} vs {match['away_name_kr']} | "
                  f"{match['match_date']} | "
                  f"배당: {match['home_odds']} / {match['draw_odds']} / {match['away_odds']}")

if __name__ == "__main__":
    asyncio.run(main())

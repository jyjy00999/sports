"""
The Odds API 연동 모듈
https://the-odds-api.com/
- Bet365, Pinnacle 등 50개 북메이커 실시간 배당 집계
- 무료: 500req/월 | 스타터: $10/월
"""

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://api.the-odds-api.com/v4"

# 지원 스포츠 키 (The Odds API 기준)
SPORT_KEYS = {
    "soccer_korea_kleague1":   "K리그1",
    "soccer_epl":              "프리미어리그",
    "soccer_spain_la_liga":    "라리가",
    "soccer_germany_bundesliga": "분데스리가",
    "soccer_italy_serie_a":    "세리에A",
    "soccer_france_ligue_one": "리그1",
    "soccer_uefa_champs_league": "챔피언스리그",
    "baseball_mlb":            "MLB",
    "basketball_nba":          "NBA",
}


class OddsAPIClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = httpx.AsyncClient(timeout=15.0)

    async def __aenter__(self): return self
    async def __aexit__(self, *_): await self.client.aclose()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
    async def get_odds(self, sport_key: str, bookmakers: str = "bet365,pinnacle,average") -> list[dict]:
        """특정 스포츠 현재 배당 조회"""
        resp = await self.client.get(f"{BASE_URL}/sports/{sport_key}/odds", params={
            "apiKey":    self.api_key,
            "regions":   "eu",
            "markets":   "h2h",
            "oddsFormat": "decimal",
            "bookmakers": bookmakers,
        })
        remaining = resp.headers.get("x-requests-remaining", "?")
        logger.info(f"Odds API 잔여 요청: {remaining}")
        resp.raise_for_status()

        results = []
        for event in resp.json():
            home_team = event.get("home_team", "")
            away_team = event.get("away_team", "")
            commence  = event.get("commence_time", "")

            for bm in event.get("bookmakers", []):
                for market in bm.get("markets", []):
                    if market["key"] != "h2h":
                        continue
                    outcomes = {o["name"]: o["price"] for o in market["outcomes"]}
                    results.append({
                        "sport_key":    sport_key,
                        "event_id":     event["id"],
                        "home_team":    home_team,
                        "away_team":    away_team,
                        "match_date":   commence,
                        "bookmaker":    bm["key"],
                        "home_odds":    outcomes.get(home_team),
                        "away_odds":    outcomes.get(away_team),
                        "draw_odds":    outcomes.get("Draw"),
                        "updated_at":   bm.get("last_update"),
                    })
        return results

    async def get_all_sports_odds(self) -> list[dict]:
        """등록된 모든 스포츠 배당 일괄 수집"""
        all_odds = []
        for sport_key, label in SPORT_KEYS.items():
            try:
                logger.info(f"배당 수집 중: {label} ({sport_key})")
                odds = await self.get_odds(sport_key)
                all_odds.extend(odds)
            except Exception as e:
                logger.error(f"{label} 배당 수집 실패: {e}")
        return all_odds

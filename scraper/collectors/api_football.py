"""
API-Football 연동 모듈
https://www.api-football.com/
- 부상/정지 선수, 라인업, 팀 스탯, H2H, 선수 시즌 스탯 수집
"""

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://v3.football.api-sports.io"


class APIFootballClient:
    def __init__(self, api_key: str):
        self.headers = {
            "x-apisports-key": api_key,
            "x-rapidapi-host": "v3.football.api-sports.io",
        }
        self.client = httpx.AsyncClient(headers=self.headers, timeout=15.0)

    async def __aenter__(self): return self
    async def __aexit__(self, *_): await self.client.aclose()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    async def _get(self, endpoint: str, params: dict) -> dict:
        url = f"{BASE_URL}/{endpoint}"
        resp = await self.client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        remaining = resp.headers.get("x-ratelimit-requests-remaining", "?")
        logger.debug(f"API-Football {endpoint} | 잔여 요청: {remaining}")
        return data

    async def get_injuries(self, fixture_id: int) -> list[dict]:
        """경기별 결장/부상/정지 선수 조회"""
        data = await self._get("injuries", {"fixture": fixture_id})
        results = []
        for item in data.get("response", []):
            player = item.get("player", {})
            results.append({
                "player_id_api":  player.get("id"),
                "player_name":    player.get("name"),
                "player_photo":   player.get("photo"),
                "team_id_api":    item.get("team", {}).get("id"),
                "team_name":      item.get("team", {}).get("name"),
                "type":           item.get("type"),   # "Missing Fixture" | "Questionable"
                "reason":         item.get("reason"),  # "Hamstring" | "Suspension"
            })
        return results

    async def get_fixture_stats(self, fixture_id: int) -> dict:
        """경기 통계 조회"""
        data = await self._get("fixtures/statistics", {"fixture": fixture_id})
        return {
            "home": data["response"][0] if len(data["response"]) > 0 else {},
            "away": data["response"][1] if len(data["response"]) > 1 else {},
        }

    async def get_head_to_head(self, team1: int, team2: int, last: int = 5) -> list[dict]:
        """두 팀 최근 맞대결 기록"""
        data = await self._get("fixtures/headtohead", {
            "h2h": f"{team1}-{team2}",
            "last": last,
        })
        return [
            {
                "fixture_id": f["fixture"]["id"],
                "date":       f["fixture"]["date"],
                "home_team":  f["teams"]["home"]["name"],
                "away_team":  f["teams"]["away"]["name"],
                "home_score": f["goals"]["home"],
                "away_score": f["goals"]["away"],
                "status":     f["fixture"]["status"]["short"],
            }
            for f in data.get("response", [])
        ]

    async def get_player_stats(self, player_id: int, season: int) -> dict:
        """선수 시즌 스탯"""
        data = await self._get("players", {"id": player_id, "season": season})
        resp = data.get("response", [])
        if not resp:
            return {}
        stats = resp[0].get("statistics", [{}])[0]
        return {
            "player_id":    resp[0]["player"]["id"],
            "name":         resp[0]["player"]["name"],
            "photo":        resp[0]["player"]["photo"],
            "nationality":  resp[0]["player"]["nationality"],
            "goals":        stats.get("goals", {}).get("total", 0),
            "assists":      stats.get("goals", {}).get("assists", 0),
            "appearances":  stats.get("games", {}).get("appearences", 0),
            "rating":       stats.get("games", {}).get("rating"),
            "minutes":      stats.get("games", {}).get("minutes", 0),
            "shots_total":  stats.get("shots", {}).get("total", 0),
            "shots_on":     stats.get("shots", {}).get("on", 0),
            "yellow_cards": stats.get("cards", {}).get("yellow", 0),
            "red_cards":    stats.get("cards", {}).get("red", 0),
        }

    async def get_fixtures_by_date(self, league_id: int, season: int, date: str) -> list[dict]:
        """날짜별 경기 목록 (팀 매핑 및 api_football_id 확보용)"""
        data = await self._get("fixtures", {
            "league": league_id,
            "season": season,
            "date":   date,   # YYYY-MM-DD
        })
        return [
            {
                "fixture_id": f["fixture"]["id"],
                "date":       f["fixture"]["date"],
                "home_id":    f["teams"]["home"]["id"],
                "home_name":  f["teams"]["home"]["name"],
                "away_id":    f["teams"]["away"]["id"],
                "away_name":  f["teams"]["away"]["name"],
                "venue":      f["fixture"].get("venue", {}).get("name"),
            }
            for f in data.get("response", [])
        ]

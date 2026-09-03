/**
 * GET /api/external/sofascore?home={팀영문명}&away={팀영문명}&sport=soccer
 * Sofascore 비공식 API로 H2H, 근래성적, 결장자 수집 (무료, API키 없음)
 */
import { NextResponse } from 'next/server';

const SOFA_BASE = 'https://api.sofascore.com/api/v1';
const SOFA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Cache-Control': 'no-cache',
};

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: SOFA_HEADERS, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function sofaGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(`${SOFA_BASE}${path}`);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// 팀 이름으로 Sofascore 팀 ID 검색 (soccer만)
async function searchTeamId(name: string, sport = 'football'): Promise<number | null> {
  const data = await sofaGet<{ results?: Array<{ type: string; entity: { id: number; sport?: { slug: string } } }> }>(
    `/search/all?q=${encodeURIComponent(name)}`
  );
  if (!data?.results) return null;
  const hit = data.results.find(r => r.type === 'team' && r.entity?.sport?.slug === sport);
  return hit?.entity?.id ?? null;
}

// 팀의 최근 N경기 W/D/L 문자열 ("WWDLW" 형태)
async function getRecentForm(teamId: number, count = 5): Promise<string> {
  const data = await sofaGet<{
    events?: Array<{
      homeTeam?: { id: number };
      awayTeam?: { id: number };
      homeScore?: { current: number };
      awayScore?: { current: number };
      status?: { type: string };
    }>
  }>(`/team/${teamId}/events/last/0`);

  if (!data?.events) return '';

  return data.events
    .filter(e => e.status?.type === 'finished')
    .slice(-count)
    .map(e => {
      const isHome = e.homeTeam?.id === teamId;
      const gs = isHome ? (e.homeScore?.current ?? 0) : (e.awayScore?.current ?? 0);
      const ga = isHome ? (e.awayScore?.current ?? 0) : (e.homeScore?.current ?? 0);
      if (gs > ga) return 'W';
      if (gs < ga) return 'L';
      return 'D';
    })
    .join('');
}

// 홈팀 다음 경기 목록에서 원정팀이 포함된 이벤트 ID 탐색
async function findSofascoreEventId(homeTeamId: number, awayTeamId: number): Promise<number | null> {
  // 다음 경기
  const next = await sofaGet<{ events?: Array<{ id: number; homeTeam?: { id: number }; awayTeam?: { id: number } }> }>(
    `/team/${homeTeamId}/events/next/0`
  );
  if (next?.events) {
    const ev = next.events.find(e =>
      (e.homeTeam?.id === homeTeamId && e.awayTeam?.id === awayTeamId) ||
      (e.homeTeam?.id === awayTeamId && e.awayTeam?.id === homeTeamId)
    );
    if (ev) return ev.id;
  }
  // 지난 경기에서도 탐색 (최근 완료된 같은 대결)
  const last = await sofaGet<{ events?: Array<{ id: number; homeTeam?: { id: number }; awayTeam?: { id: number } }> }>(
    `/team/${homeTeamId}/events/last/0`
  );
  if (last?.events) {
    const ev = [...last.events].reverse().find(e =>
      (e.homeTeam?.id === homeTeamId && e.awayTeam?.id === awayTeamId) ||
      (e.homeTeam?.id === awayTeamId && e.awayTeam?.id === homeTeamId)
    );
    if (ev) return ev.id;
  }
  return null;
}

// 이벤트의 H2H + 결장자
async function getEventExtras(eventId: number) {
  const [h2hData, lineupData] = await Promise.all([
    sofaGet<{ teamDuel?: { homeWins?: number; awayWins?: number; draws?: number } }>(`/event/${eventId}/h2h`),
    sofaGet<{
      home?: { missingPlayers?: Array<{ player?: { shortName?: string; name?: string; position?: string }; description?: string; expectedEndDate?: string }> };
      away?: { missingPlayers?: Array<{ player?: { shortName?: string; name?: string; position?: string }; description?: string; expectedEndDate?: string }> };
    }>(`/event/${eventId}/lineups`),
  ]);

  const h2h = h2hData?.teamDuel ? {
    homeWins: h2hData.teamDuel.homeWins ?? 0,
    awayWins: h2hData.teamDuel.awayWins ?? 0,
    draws: h2hData.teamDuel.draws ?? 0,
  } : null;

  const formatMissing = (arr?: Array<{ player?: { shortName?: string; name?: string; position?: string }; description?: string; expectedEndDate?: string }>) =>
    (arr ?? []).map(p => ({
      name: p.player?.shortName ?? p.player?.name ?? '?',
      position: p.player?.position ?? '',
      injury: p.description ?? '부상',
      expectedReturn: p.expectedEndDate ? p.expectedEndDate.split('T')[0] : null,
    }));

  const missing = lineupData ? {
    home: formatMissing(lineupData.home?.missingPlayers),
    away: formatMissing(lineupData.away?.missingPlayers),
  } : null;

  return { h2h, missing };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const homeEn = searchParams.get('home') ?? '';
  const awayEn = searchParams.get('away') ?? '';
  const sport = searchParams.get('sport') === 'baseball' ? 'baseball' : 'football';

  if (!homeEn || !awayEn) {
    return NextResponse.json({ error: 'home, away 파라미터 필요' }, { status: 400 });
  }

  console.log(`[Sofascore] 검색: ${homeEn} vs ${awayEn} (${sport})`);

  // 두 팀 ID 병렬 검색
  const sofaSport = sport === 'baseball' ? 'baseball' : 'football';
  const [homeId, awayId] = await Promise.all([
    searchTeamId(homeEn, sofaSport),
    searchTeamId(awayEn, sofaSport),
  ]);

  if (!homeId || !awayId) {
    console.warn(`[Sofascore] 팀 찾기 실패 — home:${homeId} away:${awayId}`);
    return NextResponse.json({ error: '팀을 Sofascore에서 찾을 수 없음', homeId, awayId }, { status: 404 });
  }

  console.log(`[Sofascore] 팀 ID — 홈:${homeId} 원정:${awayId}`);

  // 최근 폼 + 이벤트 ID 병렬 수집
  const [homeForm, awayForm, eventId] = await Promise.all([
    getRecentForm(homeId),
    getRecentForm(awayId),
    findSofascoreEventId(homeId, awayId),
  ]);

  let h2h = null, missing = null;
  if (eventId) {
    console.log(`[Sofascore] 이벤트 ID: ${eventId}`);
    const extras = await getEventExtras(eventId);
    h2h = extras.h2h;
    missing = extras.missing;
  }

  return NextResponse.json({
    homeForm,   // "WWDLW"
    awayForm,   // "LWWDW"
    h2h,        // { homeWins, awayWins, draws }
    missing,    // { home: [...], away: [...] }
    sofascoreEventId: eventId,
  });
}

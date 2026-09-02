/**
 * GET /api/external/injuries?match_id={uuid}
 * 축구 경기의 부상/결장 선수 정보 수집
 *  - EPL  : fantasy.premierleague.com (무료 공식 API)
 *  - 기타  : ESPN soccer injuries 페이지 파싱 시도
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export type InjuredPlayer = {
  name: string;
  injury: string;     // 부상 종류
  status: string;     // '결장' | '의심스러움' | '출전 불투명'
  chanceOfPlaying: number | null; // 0~100
  returnDate: string | null;
};

export type TeamInjuries = {
  teamName: string;
  players: InjuredPlayer[];
};

export type MatchInjuries = {
  home: TeamInjuries | null;
  away: TeamInjuries | null;
  source: string;
  leagueName: string;
};

// ── 리그 → transfermarkt / ESPN 코드 매핑 ─────────────────────
const LEAGUE_ESPN: Record<string, string> = {
  'epl': 'eng.1', 'premier': 'eng.1', '프리미어': 'eng.1', '잉글랜드': 'eng.1',
  '분데스': 'ger.1', 'bundesliga': 'ger.1', '독일': 'ger.1',
  '라리가': 'esp.1', 'laliga': 'esp.1', '스페인': 'esp.1',
  '세리에': 'ita.1', 'serie': 'ita.1', '이탈리아': 'ita.1',
  '리그앙': 'fra.1', 'ligue': 'fra.1', '프랑스': 'fra.1',
  'k리그': 'kor.1', 'k league': 'kor.1',
  'j리그': 'jpn.1', 'j1': 'jpn.1',
};

function getLeagueESPN(leagueName: string): string | null {
  const lower = leagueName.toLowerCase();
  for (const [k, v] of Object.entries(LEAGUE_ESPN)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

// ── EPL 팀명 매핑 (한국어 → FPL 영어 팀명 키워드) ────────────────
const EPL_KR_TO_EN: [string, string][] = [
  ['아스날','Arsenal'], ['아스날','Arsenal'],
  ['첼시','Chelsea'],
  ['맨시티','Manchester City'], ['맨체스터 시티','Manchester City'],
  ['맨유','Manchester United'], ['맨체스터 유나이티드','Manchester United'],
  ['리버풀','Liverpool'],
  ['토트넘','Tottenham'],
  ['뉴캐슬','Newcastle'],
  ['아스톤 빌라','Aston Villa'], ['아스톤빌라','Aston Villa'],
  ['웨스트햄','West Ham'],
  ['브라이튼','Brighton'],
  ['브렌트포드','Brentford'],
  ['풀럼','Fulham'],
  ['울버햄튼','Wolves'],
  ['에버턴','Everton'],
  ['크리스탈 팰리스','Crystal Palace'], ['크리스탈팰리스','Crystal Palace'],
  ['레스터','Leicester'],
  ['노팅엄','Nottingham'],
  ['본머스','Bournemouth'],
  ['사우샘프턴','Southampton'],
  ['번리','Burnley'],
  ['루턴','Luton'],
  ['셰필드','Sheffield'],
];

function krToEplEn(krName: string): string {
  for (const [kr, en] of EPL_KR_TO_EN) {
    if (krName.includes(kr)) return en;
  }
  return krName;
}

// ── EPL 부상자 조회 (FPL API) ─────────────────────────────────
async function fetchEPLInjuries(homeKr: string, awayKr: string): Promise<MatchInjuries> {
  try {
    const url = 'https://fantasy.premierleague.com/api/bootstrap-static/';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { home: null, away: null, source: 'FPL', leagueName: 'EPL' };
    const data = await res.json();

    const fplTeams = (data.teams ?? []) as Array<{ id: number; name: string; short_name: string }>;
    const fplPlayers = (data.elements ?? []) as Array<{
      team: number;
      web_name: string;
      first_name: string;
      second_name: string;
      status: string;         // 'a'=available, 'i'=injured, 'd'=doubtful, 'u'=unavailable, 's'=suspended
      news: string;
      chance_of_playing_next_round: number | null;
    }>;

    const homeEn = krToEplEn(homeKr);
    const awayEn = krToEplEn(awayKr);

    const homeTeam = fplTeams.find(t =>
      t.name.toLowerCase().includes(homeEn.split(' ').pop()!.toLowerCase()) ||
      homeEn.toLowerCase().includes(t.name.split(' ').pop()!.toLowerCase())
    );
    const awayTeam = fplTeams.find(t =>
      t.name.toLowerCase().includes(awayEn.split(' ').pop()!.toLowerCase()) ||
      awayEn.toLowerCase().includes(t.name.split(' ').pop()!.toLowerCase())
    );

    const toInjured = (team: typeof fplTeams[0] | undefined): TeamInjuries | null => {
      if (!team) return null;
      const injured = fplPlayers.filter(p =>
        p.team === team.id && p.status !== 'a' // 'a'(available) 제외
      ).map(p => {
        let status = '결장';
        if (p.status === 'd') status = '출전 의심스러움';
        else if (p.status === 's') status = '출전 정지';
        else if (p.status === 'u') status = '결장';
        return {
          name: `${p.first_name} ${p.second_name}` || p.web_name,
          injury: p.news || '부상',
          status,
          chanceOfPlaying: p.chance_of_playing_next_round,
          returnDate: null,
        };
      });
      return { teamName: team.name, players: injured };
    };

    return {
      home: toInjured(homeTeam),
      away: toInjured(awayTeam),
      source: 'FPL',
      leagueName: 'EPL',
    };
  } catch (e) {
    console.error('[Injuries EPL]', e);
    return { home: null, away: null, source: 'FPL', leagueName: 'EPL' };
  }
}

// ── ESPN 부상자 조회 (타 리그) ─────────────────────────────────
async function fetchESPNInjuries(homeKr: string, awayKr: string, espnCode: string, leagueName: string): Promise<MatchInjuries> {
  try {
    const url = `https://www.espn.com/soccer/injuries/_/league/${espnCode}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      cache: 'no-store',
    });
    if (!res.ok) return { home: null, away: null, source: 'ESPN', leagueName };

    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[\s\S]*?<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ');

    // ESPN injury 페이지 파싱: 팀 이름으로 섹션 찾기
    const parseTeamInjuries = (krName: string): TeamInjuries | null => {
      // 영문팀명 추출 시도 (한-영 일부 매핑)
      // ESPN은 영어 팀명으로 구분됨
      const players: InjuredPlayer[] = [];
      // 단순 패턴: 선수명, 부상내용, 날짜 형태로 반복
      // ESPN 구조가 가변적이므로 best-effort 파싱
      const injuryPattern = /([A-Z][a-z]+ [A-Z][a-z]+)\s+([\w\s]+?)\s+(Day-to-day|Out|Questionable|Probable|Suspended)/gi;
      let m;
      while ((m = injuryPattern.exec(text)) !== null) {
        players.push({
          name: m[1],
          injury: m[2].trim(),
          status: m[3] === 'Out' || m[3] === 'Suspended' ? '결장' : '출전 불투명',
          chanceOfPlaying: null,
          returnDate: null,
        });
      }
      if (players.length === 0) return null;
      return { teamName: krName, players: players.slice(0, 10) };
    };

    return {
      home: parseTeamInjuries(homeKr),
      away: parseTeamInjuries(awayKr),
      source: 'ESPN',
      leagueName,
    };
  } catch (e) {
    console.error('[Injuries ESPN]', e);
    return { home: null, away: null, source: 'ESPN', leagueName };
  }
}

// ── API 핸들러 ──────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get('match_id');
  if (!matchId) return NextResponse.json({ error: 'match_id 필요' }, { status: 400 });

  const { data: match, error } = await supabase
    .from('matches')
    .select(`
      id, match_date,
      home_team:home_team_id(name_kr, name_en),
      away_team:away_team_id(name_kr, name_en),
      league:league_id(name_kr, name_en)
    `)
    .eq('id', matchId)
    .single();

  if (error || !match) return NextResponse.json({ error: '경기 없음' }, { status: 404 });

  const homeKr = (match.home_team as { name_kr?: string } | null)?.name_kr ?? '';
  const awayKr = (match.away_team as { name_kr?: string } | null)?.name_kr ?? '';
  const leagueKr = (match.league as { name_kr?: string } | null)?.name_kr ?? '';

  // EPL 여부 먼저 확인
  const isEPL = ['프리미어','premier','epl','잉글랜드'].some(k => leagueKr.toLowerCase().includes(k));
  if (isEPL) {
    const result = await fetchEPLInjuries(homeKr, awayKr);
    return NextResponse.json(result);
  }

  // 타 리그 ESPN 시도
  const espnCode = getLeagueESPN(leagueKr);
  if (espnCode) {
    const result = await fetchESPNInjuries(homeKr, awayKr, espnCode, leagueKr);
    return NextResponse.json(result);
  }

  // 알 수 없는 리그
  return NextResponse.json({ home: null, away: null, source: 'none', leagueName: leagueKr });
}

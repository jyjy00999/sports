/**
 * GET /api/external/pitchers?match_id={uuid}
 * 야구 경기의 선발 투수 + 시즌 성적 수집
 *  - MLB : statsapi.mlb.com (무료 공식 API)
 *  - NPB : npb.jp 일정 페이지 파싱
 *  - KBO : koreabaseball.com (차단 시 null 반환)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export type PitcherStat = {
  name: string;
  era: number | null;
  wins: number | null;
  losses: number | null;
  whip: number | null;
  ip: number | null;    // innings pitched
  k9: number | null;    // strikeouts per 9 innings
  source: string;       // 'MLB' | 'NPB' | 'KBO'
};

export type TeamBattingStats = {
  avg: number | null;        // 팀 타율 (예: 0.265)
  homeRuns: number | null;   // 시즌 홈런
  hits: number | null;       // 시즌 안타
  strikeOuts: number | null; // 시즌 삼진 (타자 기준)
  obp: number | null;        // 출루율
  ops: number | null;        // OPS
};

export type MatchPitchers = {
  home: PitcherStat | null;
  away: PitcherStat | null;
  leagueType: 'MLB' | 'KBO' | 'NPB' | 'unknown';
  homeTeamStats?: TeamBattingStats | null;
  awayTeamStats?: TeamBattingStats | null;
};

// ── 리그 감지 ──────────────────────────────────────────────────
const KBO_KEYWORDS = ['두산','LG','삼성','기아','KIA','롯데','SSG','SK','키움','넥센','한화','NC','KT'];
const NPB_KEYWORDS = ['요미우리','자이언츠','한신','타이거스','히로시마','카프','DeNA','dena','베이스타스','추니치','드래곤스','야쿠르트','스왈로스','소프트뱅크','호크스','오릭스','버팔로스','치바 롯데','마린스','세이부','라이온스','닛폰햄','니혼햄','파이터스','라쿠텐','이글스'];
const MLB_KEYWORDS = ['양키스','메츠','레드삭스','다저스','에인절스','자이언츠','파드레스','컵스','화이트삭스','애스트로스','레인저스','브레이브스','필리스','말린스','내셔널스','카디널스','브루어스','파이리츠','레즈','트윈스','타이거스','가디언스','로열스','매리너스','애슬레틱스','어슬레틱스','로키스','다이아몬드백스','레이스','오리올스','블루제이스'];

function detectLeague(homeKr: string, awayKr: string): 'MLB' | 'KBO' | 'NPB' | 'unknown' {
  const combined = homeKr + ' ' + awayKr;
  if (KBO_KEYWORDS.some(k => combined.includes(k))) return 'KBO';
  if (NPB_KEYWORDS.some(k => combined.toLowerCase().includes(k.toLowerCase()))) return 'NPB';
  if (MLB_KEYWORDS.some(k => combined.includes(k))) return 'MLB';
  return 'unknown';
}

// ── MLB 팀명 매핑 (한국어 키워드 → 영어 검색어) ────────────────────
const MLB_KR_TO_EN_KW: [string, string][] = [
  ['양키스','Yankees'], ['메츠','Mets'], ['레드삭스','Red Sox'], ['다저스','Dodgers'],
  ['에인절스','Angels'], ['파드레스','Padres'], ['컵스','Cubs'], ['화이트삭스','White Sox'],
  ['애스트로스','Astros'], ['레인저스','Rangers'], ['브레이브스','Braves'], ['필리스','Phillies'],
  ['말린스','Marlins'], ['내셔널스','Nationals'], ['카디널스','Cardinals'], ['브루어스','Brewers'],
  ['파이리츠','Pirates'], ['레즈','Reds'], ['트윈스','Twins'], ['타이거스','Tigers'],
  ['가디언스','Guardians'], ['로열스','Royals'], ['매리너스','Mariners'],
  ['애슬레틱스','Athletics'], ['어슬레틱스','Athletics'],
  ['로키스','Rockies'], ['다이아몬드백스','Diamondbacks'], ['레이스','Rays'],
  ['오리올스','Orioles'], ['블루제이스','Blue Jays'],
  // 자이언츠는 SF/NY 구분
  ['SF 자이언츠','San Francisco Giants'], ['SF자이언츠','San Francisco Giants'],
  ['샌프란시스코','San Francisco Giants'],
];

function krToMlbKw(krName: string): string {
  for (const [kr, en] of MLB_KR_TO_EN_KW) {
    if (krName.includes(kr)) return en;
  }
  return krName;
}

// ── NPB 팀명 매핑 (한국어 → 일본어 약칭) ────────────────────────
const NPB_KR_TO_JP: [string, string][] = [
  ['요미우리','巨人'], ['자이언츠','巨人'],
  ['한신','阪神'], ['타이거스','阪神'],
  ['히로시마','広島'], ['카프','広島'],
  ['DeNA','DeNA'], ['dena','DeNA'], ['베이스타스','DeNA'],
  ['추니치','中日'], ['드래곤스','中日'],
  ['야쿠르트','ヤクルト'], ['스왈로스','ヤクルト'],
  ['소프트뱅크','ソフトバンク'], ['호크스','ソフトバンク'],
  ['오릭스','オリックス'], ['버팔로스','オリックス'],
  ['치바 롯데','ロッテ'], ['마린스','ロッテ'],
  ['세이부','西武'], ['라이온스','西武'],
  ['닛폰햄','日本ハム'], ['니혼햄','日本ハム'], ['파이터스','日本ハム'],
  ['라쿠텐','楽天'], ['이글스','楽天'],
];

function krToNpbJp(krName: string): string {
  for (const [kr, jp] of NPB_KR_TO_JP) {
    if (krName.toLowerCase().includes(kr.toLowerCase())) return jp;
  }
  return '';
}

// ── MLB 팀 타격 통계 조회 ─────────────────────────────────────────
async function fetchMLBTeamBatting(teamId: number): Promise<TeamBattingStats | null> {
  try {
    const season = new Date().getFullYear();
    const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const stat = (data.stats?.[0]?.splits?.[0]?.stat ?? {}) as Record<string, unknown>;
    return {
      avg:        stat.avg        ? parseFloat(stat.avg as string) : null,
      homeRuns:   (stat.homeRuns  as number | null) ?? null,
      hits:       (stat.hits      as number | null) ?? null,
      strikeOuts: (stat.strikeOuts as number | null) ?? null,
      obp:        stat.obp        ? parseFloat(stat.obp as string) : null,
      ops:        stat.ops        ? parseFloat(stat.ops as string) : null,
    };
  } catch {
    return null;
  }
}

// ── MLB 선발 + 성적 + 팀 타격 통계 조회 ────────────────────────────
async function fetchMLBPitchers(homeKr: string, awayKr: string, matchDate: string): Promise<MatchPitchers> {
  try {
    const dateStr = matchDate.slice(0, 10);
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=probablePitcher,teams`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { home: null, away: null, leagueType: 'MLB' };
    const data = await res.json();
    const games: unknown[] = data.dates?.[0]?.games ?? [];

    const homeKw = krToMlbKw(homeKr);
    const awayKw = krToMlbKw(awayKr);

    // 게임 매칭
    let matched: Record<string,unknown> | null = null;
    let swapped = false;
    for (const g of games) {
      const game = g as Record<string,unknown>;
      const teams = game.teams as Record<string,unknown>;
      const h = (teams?.home as Record<string,unknown>)?.team as Record<string,unknown>;
      const a = (teams?.away as Record<string,unknown>)?.team as Record<string,unknown>;
      const hn = (h?.name as string) ?? '';
      const an = (a?.name as string) ?? '';
      if (hn.includes(homeKw.split(' ').pop()!) && an.includes(awayKw.split(' ').pop()!)) {
        matched = game; break;
      }
      if (hn.includes(awayKw.split(' ').pop()!) && an.includes(homeKw.split(' ').pop()!)) {
        matched = game; swapped = true; break; // home/away 순서가 뒤바뀐 경우
      }
    }

    if (!matched) return { home: null, away: null, leagueType: 'MLB' };

    const teams = matched.teams as Record<string,unknown>;
    const homeTeamObj = (teams?.[swapped ? 'away' : 'home'] as Record<string,unknown>);
    const awayTeamObj = (teams?.[swapped ? 'home' : 'away'] as Record<string,unknown>);
    const hp = homeTeamObj?.probablePitcher as Record<string,unknown> | undefined;
    const ap = awayTeamObj?.probablePitcher as Record<string,unknown> | undefined;
    const homeTeamId = (homeTeamObj?.team as Record<string,unknown>)?.id as number | undefined;
    const awayTeamId = (awayTeamObj?.team as Record<string,unknown>)?.id as number | undefined;

    const [homeStats, awayStats, homeTeamStats, awayTeamStats] = await Promise.all([
      hp?.id ? fetchMLBStats(hp.id as number, hp.fullName as string) : Promise.resolve(null),
      ap?.id ? fetchMLBStats(ap.id as number, ap.fullName as string) : Promise.resolve(null),
      homeTeamId ? fetchMLBTeamBatting(homeTeamId) : Promise.resolve(null),
      awayTeamId ? fetchMLBTeamBatting(awayTeamId) : Promise.resolve(null),
    ]);
    return { home: homeStats, away: awayStats, leagueType: 'MLB', homeTeamStats, awayTeamStats };
  } catch (e) {
    console.error('[Pitchers MLB]', e);
    return { home: null, away: null, leagueType: 'MLB' };
  }
}

async function fetchMLBStats(id: number, name: string): Promise<PitcherStat> {
  const season = new Date().getFullYear();
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${season}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    const stat = (data.stats?.[0]?.splits?.[0]?.stat ?? {}) as Record<string,unknown>;
    return {
      name,
      era:  stat.era  ? parseFloat(stat.era  as string) : null,
      wins: stat.wins as number | null ?? null,
      losses: stat.losses as number | null ?? null,
      whip: stat.whip ? parseFloat(stat.whip as string) : null,
      ip:   stat.inningsPitched ? parseFloat(stat.inningsPitched as string) : null,
      k9:   stat.strikeoutsPer9Inn ? parseFloat(stat.strikeoutsPer9Inn as string) : null,
      source: 'MLB',
    };
  } catch {
    return { name, era: null, wins: null, losses: null, whip: null, ip: null, k9: null, source: 'MLB' };
  }
}

// ── NPB 일정 略称 → 선수명단 파일 코드 ─────────────────────────────
const NPB_SCH_TO_RST: Array<[string, string]> = [
  ['巨人', 'g'],  ['読売', 'g'],
  ['DeNA', 'db'], ['ＤｅＮＡ', 'db'], ['横浜', 'db'],
  ['阪神', 't'],
  ['中日', 'd'],
  ['広島', 'c'],
  ['ヤクルト', 's'],
  ['ソフトバンク', 'h'],
  ['日本ハム', 'f'],
  ['オリックス', 'b'],
  ['楽天', 'e'],
  ['西武', 'l'],
  ['ロッテ', 'm'],
];

function npbSchToRst(abbr: string): string | null {
  for (const [key, code] of NPB_SCH_TO_RST) {
    if (abbr.includes(key) || key.includes(abbr)) return code;
  }
  return null;
}

const NPB_FETCH_OPTS: RequestInit = {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' },
  cache: 'no-store',
};

// 팀 선수명단 조회: { name(공백제거), id } 배열
async function fetchNPBRoster(rstCode: string): Promise<Array<{ name: string; id: string }>> {
  try {
    const res = await fetchWithTimeout(`https://npb.jp/bis/teams/rst_${rstCode}.html`, NPB_FETCH_OPTS, 8000);
    if (!res.ok) return [];
    const html = await res.text();
    const players: Array<{ name: string; id: string }> = [];
    const regex = /\/bis\/players\/(\d+)\.html"[^>]*>\s*([^<]+?)\s*</g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const id = m[1];
      const name = m[2].replace(/[\s　]+/g, ''); // 전각 공백 포함 제거
      if (id && name && !/成績|一覧|検索/.test(name)) {
        players.push({ id, name });
      }
    }
    return players;
  } catch {
    return [];
  }
}

// 일정 약칭(e.g. "伊藤将")으로 선수 ID 찾기
function findNPBPlayer(roster: Array<{ name: string; id: string }>, abbr: string): string | null {
  if (!abbr) return null;
  // 1. 완전 일치
  const exact = roster.find(p => p.name === abbr);
  if (exact) return exact.id;
  // 2. 풀네임이 약칭으로 시작
  const sw = roster.find(p => p.name.startsWith(abbr));
  if (sw) return sw.id;
  // 3. 성씨 2글자만으로 유일 매칭
  if (abbr.length >= 2) {
    const byLn = roster.filter(p => p.name.startsWith(abbr.slice(0, 2)));
    if (byLn.length === 1) return byLn[0].id;
  }
  return null;
}

// NPB 선수 페이지에서 투수 시즌 성적 파싱
async function fetchNPBPlayerPitchStats(id: string, name: string): Promise<PitcherStat> {
  const base: PitcherStat = { name, era: null, wins: null, losses: null, whip: null, ip: null, k9: null, source: 'NPB' };
  try {
    const res = await fetchWithTimeout(`https://npb.jp/bis/players/${id}.html`, NPB_FETCH_OPTS, 8000);
    if (!res.ok) return base;
    const html = await res.text();
    const year = new Date().getFullYear();
    // 태그 제거 후 탭 구분 텍스트로 변환
    const plain = html.replace(/<[^>]+>/g, '\t').replace(/&[a-z]+;/g, ' ').replace(/\t+/g, '\t');
    for (const line of plain.split('\n')) {
      const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
      // 열 순서: 年度 球団 登板 勝利 敗北 S H HP 完投 完封 無四球 勝率 打者 投球回 安打 本塁打 四球 死球 三振 暴投 ボーク 失点 自責点 防御率
      //          0     1    2    3    4    5  6  7   8    9    10    11   12   13    14   15    16   17   18   19   20    21   22    23
      if (cols.length >= 22 && cols[0] === String(year)) {
        const w   = parseInt(cols[3]);
        const l   = parseInt(cols[4]);
        const ip  = parseFloat(cols[13]);
        const hA  = parseInt(cols[14]);
        const bb  = parseInt(cols[16]);
        const k   = parseInt(cols[18]);
        const era = parseFloat(cols[23]);
        const whip = (!isNaN(ip) && ip > 0 && !isNaN(hA) && !isNaN(bb))
          ? parseFloat(((hA + bb) / ip).toFixed(2)) : null;
        return {
          name,
          era:    isNaN(era) ? null : era,
          wins:   isNaN(w)   ? null : w,
          losses: isNaN(l)   ? null : l,
          whip,
          ip:     isNaN(ip)  ? null : ip,
          k9: (!isNaN(k) && !isNaN(ip) && ip > 0) ? parseFloat((k / ip * 9).toFixed(2)) : null,
          source: 'NPB',
        };
      }
    }
  } catch (e) {
    console.error('[NPB player stats]', e);
  }
  return base;
}

// ── NPB 선발 조회 (npb.jp) — 이름 + 시즌 성적 ────────────────────
async function fetchNPBPitchers(homeKr: string, awayKr: string, matchDate: string): Promise<MatchPitchers> {
  try {
    const d = new Date(matchDate);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const url = `https://npb.jp/games/${year}/schedule_${month}_detail.html`;
    const res = await fetchWithTimeout(url, NPB_FETCH_OPTS, 8000);
    if (!res.ok) return { home: null, away: null, leagueType: 'NPB' };
    const html = await res.text();

    const homeJp = krToNpbJp(homeKr);
    const awayJp = krToNpbJp(awayKr);
    if (!homeJp || !awayJp) return { home: null, away: null, leagueType: 'NPB' };

    const dayNum = d.getDate();
    const monthNum = d.getMonth() + 1;
    const dayPattern = `${monthNum}/${dayNum}（`;

    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const dayIdx = text.indexOf(dayPattern);
    if (dayIdx < 0) return { home: null, away: null, leagueType: 'NPB' };

    const afterDay = text.slice(dayIdx, dayIdx + 5000);

    // "A - B ... 先発：X 先発：Y" 패턴 파싱
    const gameRegex = /([^\s]{1,8})\s+[-－]\s+([^\s]{1,8})[^先]*先発：(\S+)\s+先発：(\S+)/g;
    let m;
    while ((m = gameRegex.exec(afterDay)) !== null) {
      const [, t1, t2, p1, p2] = m;
      const homeMatch = t1.includes(homeJp) || t2.includes(homeJp);
      const awayMatch = t1.includes(awayJp) || t2.includes(awayJp);
      if (homeMatch && awayMatch) {
        const homeIsT1 = t1.includes(homeJp);
        const homeStarterAbbr = homeIsT1 ? p1 : p2;
        const awayStarterAbbr = homeIsT1 ? p2 : p1;
        const homeTeamAbbr    = homeIsT1 ? t1 : t2;
        const awayTeamAbbr    = homeIsT1 ? t2 : t1;

        // 팀 코드 조회
        const homeCode = npbSchToRst(homeTeamAbbr);
        const awayCode = npbSchToRst(awayTeamAbbr);

        // 선수명단 병렬 조회
        const [homeRoster, awayRoster] = await Promise.all([
          homeCode ? fetchNPBRoster(homeCode) : Promise.resolve([]),
          awayCode ? fetchNPBRoster(awayCode) : Promise.resolve([]),
        ]);

        const homePlayerId = findNPBPlayer(homeRoster, homeStarterAbbr);
        const awayPlayerId = findNPBPlayer(awayRoster, awayStarterAbbr);

        // 개인 성적 병렬 조회
        const [homePitcher, awayPitcher] = await Promise.all([
          homePlayerId
            ? fetchNPBPlayerPitchStats(homePlayerId, homeStarterAbbr)
            : Promise.resolve<PitcherStat>({ name: homeStarterAbbr, era: null, wins: null, losses: null, whip: null, ip: null, k9: null, source: 'NPB' }),
          awayPlayerId
            ? fetchNPBPlayerPitchStats(awayPlayerId, awayStarterAbbr)
            : Promise.resolve<PitcherStat>({ name: awayStarterAbbr, era: null, wins: null, losses: null, whip: null, ip: null, k9: null, source: 'NPB' }),
        ]);

        console.log(`[NPB] 홈:${homeStarterAbbr}(${homePlayerId}) ERA:${homePitcher.era} 원정:${awayStarterAbbr}(${awayPlayerId}) ERA:${awayPitcher.era}`);
        return { home: homePitcher, away: awayPitcher, leagueType: 'NPB' };
      }
    }
    return { home: null, away: null, leagueType: 'NPB' };
  } catch (e) {
    console.error('[Pitchers NPB]', e);
    return { home: null, away: null, leagueType: 'NPB' };
  }
}

// ── KBO 팀명 정규화 (Betman 한국어 → KBO 공식 약칭) ─────────────────
function normalizeKBOTeam(krName: string): string {
  const map: [string, string][] = [
    ['두산', '두산'], ['베어스', '두산'], ['OB', '두산'],
    ['LG', 'LG'], ['트윈스', 'LG'],
    ['기아', 'KIA'], ['KIA', 'KIA'], ['타이거즈', 'KIA'],
    ['삼성', '삼성'], ['라이온즈', '삼성'],
    ['KT', 'KT'], ['위즈', 'KT'],
    ['키움', '키움'], ['히어로즈', '키움'], ['넥센', '키움'],
    ['SSG', 'SSG'], ['랜더스', 'SSG'], ['SK', 'SSG'],
    ['롯데', '롯데'], ['자이언츠', '롯데'],
    ['NC', 'NC'], ['다이노스', 'NC'],
    ['한화', '한화'], ['이글스', '한화'],
  ];
  for (const [key, val] of map) {
    if (krName.includes(key)) return val;
  }
  return krName.split(' ')[0]; // 첫 번째 단어만 사용
}

// ── KBO 투수 기록 파싱 (web1.koreabaseball.com 기록실) ───────────────
async function fetchKBOPitcherStats(year: number): Promise<Map<string, PitcherStat>> {
  const map = new Map<string, PitcherStat>();
  try {
    const res = await fetchWithTimeout(`https://web1.koreabaseball.com/Record/Player/PitcherBasic/Basic1.aspx`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://web1.koreabaseball.com/',
      },
      cache: 'no-store',
    }, 8000);
    if (!res.ok) return map;
    const html = await res.text();
    // 표 행 파싱: 순위 선수명 팀명 ERA G W L SV HLD WPCT IP H HR BB HBP SO R ER WHIP
    const rowRegex = /<tr[^>]*>\s*(?:<td[^>]*>\s*\d+\s*<\/td>)\s*<td[^>]*>\s*([가-힣A-Za-z]{2,15})\s*<\/td>\s*<td[^>]*>\s*([가-힣A-Za-z]+)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>\s*<td[^>]*>\s*\d+\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>[^]*?<td[^>]*>\s*([\d.]+)\s*<\/td>\s*<\/tr>/g;
    let m;
    // m[1]=선수명 m[2]=팀 m[3]=ERA m[4]=승 m[5]=패 m[6]=WHIP
    while ((m = rowRegex.exec(html)) !== null) {
      const [, name, , eraStr, wStr, lStr, whipStr] = m;
      const n = name.trim();
      if (n) {
        map.set(n, {
          name: n,
          era:    parseFloat(eraStr)  || null,
          wins:   parseInt(wStr)      || null,
          losses: parseInt(lStr)      || null,
          whip:   parseFloat(whipStr) || null,
          ip: null, k9: null,
          source: 'KBO',
        });
      }
    }
    // 정규식 실패 시 text 기반 파싱
    if (map.size === 0) {
      const plain = html.replace(/<[^>]+>/g, '\t').replace(/\t+/g, '\t');
      const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
        // 순위(숫자) 선수명 팀명 ERA W L ...
        if (cols.length >= 6 && /^\d+$/.test(cols[0]) && /^[\d.]+$/.test(cols[3])) {
          const name = cols[1];
          map.set(name, {
            name,
            era:    parseFloat(cols[3]) || null,
            wins:   parseInt(cols[5])   || null,
            losses: parseInt(cols[6])   || null,
            whip:   parseFloat(cols[cols.length - 1]) || null,
            ip: null, k9: null,
            source: 'KBO',
          });
        }
      }
    }
    console.log(`[KBO] 투수 ${map.size}명 파싱 완료 (${year})`);
  } catch (e) {
    console.error('[KBO pitcher stats]', e);
  }
  return map;
}

// ── KBO 팀 타격 통계 파싱 ────────────────────────────────────────────
async function fetchKBOTeamBatting(): Promise<Map<string, TeamBattingStats>> {
  const map = new Map<string, TeamBattingStats>();
  try {
    const res = await fetchWithTimeout('https://web1.koreabaseball.com/Record/Team/Hitter/Basic1.aspx', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://web1.koreabaseball.com/',
      },
      cache: 'no-store',
    }, 8000);
    if (!res.ok) return map;
    const html = await res.text();
    // 표 행: 순위 팀명 AVG G PA AB R H 2B 3B HR TB RBI SAC SF
    const plain = html.replace(/<[^>]+>/g, '\t').replace(/\t+/g, '\t');
    const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 11 && /^\d+$/.test(cols[0]) && /^0\.\d+$/.test(cols[2])) {
        const teamName = cols[1]; // 삼성, KT, LG ...
        map.set(teamName, {
          avg:        parseFloat(cols[2])  || null,
          homeRuns:   parseInt(cols[10])   || null,
          hits:       parseInt(cols[7])    || null,
          strikeOuts: null,                          // 이 표엔 삼진 없음
          obp:        null,
          ops:        null,
        });
      }
    }
    console.log(`[KBO] 팀 타격 ${map.size}팀 파싱 완료`);
  } catch (e) {
    console.error('[KBO team batting]', e);
  }
  return map;
}

// ── fetch + 타임아웃 헬퍼 ─────────────────────────────────────────
async function fetchWithTimeout(url: string, opts: RequestInit, ms = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── KBO 선발투수 + 시즌 성적 + 팀 타격 통계 조회 ─────────────────────
async function fetchKBOPitchers(homeKr: string, awayKr: string, matchDate: string): Promise<MatchPitchers> {
  try {
    const homeShort = normalizeKBOTeam(homeKr);
    const awayShort = normalizeKBOTeam(awayKr);
    const year = new Date(matchDate).getFullYear();

    // 1. KBO 메인 페이지에서 오늘 선발투수 추출
    const mainRes = await fetchWithTimeout('https://web1.koreabaseball.com/Default.aspx', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      cache: 'no-store',
    }, 8000);

    let homeStarterName = '';
    let awayStarterName = '';

    if (mainRes.ok) {
      const html = await mainRes.text();
      // HTML 속성에서 파싱: away_nm="LG" home_nm="두산" away_p_id="..." home_p_id="..."
      // + 투수명: <span class="before">선</span>김윤식
      const gameRegex = /class="game-cont"[^>]*away_nm="([^"]+)"[^>]*home_nm="([^"]+)"[^>]*>[\s\S]*?class="team away"[\s\S]*?<span[^>]*>선<\/span>([^<\s]+)[\s\S]*?class="team home"[\s\S]*?<span[^>]*>선<\/span>([^<\s]+)/g;
      let gm;
      while ((gm = gameRegex.exec(html)) !== null) {
        const [, awayNm, homeNm, awayP, homeP] = gm;
        const awayNorm = normalizeKBOTeam(awayNm);
        const homeNorm = normalizeKBOTeam(homeNm);
        if (
          (homeNorm === homeShort || homeNm.includes(homeShort)) &&
          (awayNorm === awayShort || awayNm.includes(awayShort))
        ) {
          homeStarterName = homeP.trim();
          awayStarterName = awayP.trim();
          console.log(`[KBO] 선발 매칭: ${awayShort} ${awayStarterName} vs ${homeShort} ${homeStarterName}`);
          break;
        }
      }
    }

    // 2. 투수 시즌 성적 + 팀 타격 통계 병렬 조회
    const [pitcherMap, teamBattingMap] = await Promise.all([
      fetchKBOPitcherStats(year),
      fetchKBOTeamBatting(),
    ]);

    const homePitcher = homeStarterName
      ? (pitcherMap.get(homeStarterName) ?? {
          name: homeStarterName, era: null, wins: null, losses: null,
          whip: null, ip: null, k9: null, source: 'KBO',
        })
      : null;

    const awayPitcher = awayStarterName
      ? (pitcherMap.get(awayStarterName) ?? {
          name: awayStarterName, era: null, wins: null, losses: null,
          whip: null, ip: null, k9: null, source: 'KBO',
        })
      : null;

    const homeTeamStats = teamBattingMap.get(homeShort) ?? null;
    const awayTeamStats = teamBattingMap.get(awayShort) ?? null;

    return { home: homePitcher, away: awayPitcher, leagueType: 'KBO', homeTeamStats, awayTeamStats };
  } catch (e) {
    console.error('[Pitchers KBO]', e);
    return { home: null, away: null, leagueType: 'KBO' };
  }
}

// ── API 핸들러 ──────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get('match_id');
  if (!matchId) return NextResponse.json({ error: 'match_id 필요' }, { status: 400 });

  const { data: match, error } = await supabase
    .from('matches')
    .select('id, match_date, home_team:home_team_id(name_kr, name_en), away_team:away_team_id(name_kr, name_en)')
    .eq('id', matchId)
    .single();

  if (error || !match) return NextResponse.json({ error: '경기 없음' }, { status: 404 });

  const homeKr = (match.home_team as { name_kr?: string } | null)?.name_kr ?? '';
  const awayKr = (match.away_team as { name_kr?: string } | null)?.name_kr ?? '';
  const matchDate = match.match_date as string;

  const league = detectLeague(homeKr, awayKr);
  let result: MatchPitchers;

  if (league === 'MLB')      result = await fetchMLBPitchers(homeKr, awayKr, matchDate);
  else if (league === 'NPB') result = await fetchNPBPitchers(homeKr, awayKr, matchDate);
  else if (league === 'KBO') result = await fetchKBOPitchers(homeKr, awayKr, matchDate);
  else                       result = { home: null, away: null, leagueType: 'unknown' };

  return NextResponse.json(result);
}

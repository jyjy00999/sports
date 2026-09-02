/**
 * GET  /api/matches/zentoto  — 젠토토 사이트에서 미시작 경기 수집 후 DB 저장
 * POST /api/matches/zentoto  — 브라우저가 직접 추출한 rows 배열을 받아 DB 저장 (SSR 실패 시 fallback)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// ── 리그/팀 생성 헬퍼 ──────────────────────────────────────
async function findOrCreateLeague(name_kr: string) {
  const { data } = await supabase.from('leagues').select('id').eq('name_kr', name_kr).limit(1);
  if (data?.length) return data[0].id;
  const sport = await supabase.from('sports').select('id').eq('name_en', 'soccer').limit(1);
  const sport_id = sport.data?.[0]?.id ?? null;
  const { data: ins } = await supabase.from('leagues').insert({ name_kr, name_en: name_kr, sport_id }).select('id');
  return ins?.[0]?.id ?? null;
}

async function findOrCreateTeam(name_kr: string, league_id: string | null) {
  const { data: alias } = await supabase.from('team_aliases').select('team_id').eq('alias', name_kr).limit(1);
  if (alias?.length) return alias[0].team_id;
  const { data: team } = await supabase.from('teams').select('id').eq('name_kr', name_kr).limit(1);
  if (team?.length) {
    await supabase.from('team_aliases').upsert({ team_id: team[0].id, alias: name_kr, source: 'zentoto' });
    return team[0].id;
  }
  const { data: newTeam } = await supabase.from('teams').insert({ name_kr, name_en: name_kr, league_id }).select('id');
  if (newTeam?.[0]?.id) {
    await supabase.from('team_aliases').insert({ team_id: newTeam[0].id, alias: name_kr, source: 'zentoto' });
    return newTeam[0].id;
  }
  return null;
}

// ── 타입 ──────────────────────────────────────────────────
export type ZentotoRow = {
  no: string;
  round: string;
  datetimeRaw: string;  // "2026-09-02 (수) 03:45"
  baseName: string;     // 홈팀명 (접미사 제거)
  suffix: string;       // "(H-1.0)", "(U/O2.5)", "(홀/짝)", "(승1패)" 또는 ""
  awayName: string;
  betCnt: string;       // "2" or "3"
  payW: string;         // 홈승/언더/홀 배당
  payD: string;         // 무 배당 (없으면 "0.00")
  payL: string;         // 원정승/오버/짝 배당
};

type BetRow = {
  combo_no: number;
  type: string;
  label: string;
  line_value: string | null;
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  under_odds?: number | null;
  over_odds?: number | null;
  odd_odds?: number | null;
  even_odds?: number | null;
};

type MatchGroup = {
  baseNo: number;
  round: string;
  matchDate: string;  // ISO
  baseName: string;
  awayName: string;
  betTypes: BetRow[];
};

// ── 베팅 유형 매핑 ──────────────────────────────────────────
function makeBetRow(row: ZentotoRow): BetRow {
  const { suffix, payW, payD, payL, no } = row;
  const w = parseFloat(payW) > 0 ? parseFloat(payW) : null;
  const d = parseFloat(payD) > 0 ? parseFloat(payD) : null;
  const l = parseFloat(payL) > 0 ? parseFloat(payL) : null;
  const n = parseInt(no);

  const hMatch = suffix.match(/H([+-][\d.]+)/i);
  if (hMatch) {
    return { combo_no: n, type: 'handicap', label: `핸디캡 ${hMatch[0]}`, line_value: hMatch[0], home_odds: w, draw_odds: d, away_odds: l };
  }
  const uoMatch = suffix.match(/U\/O([\d.]+)/i);
  if (uoMatch) {
    return { combo_no: n, type: 'under_over', label: `언더오버 U/O ${uoMatch[1]}`, line_value: `U/O ${uoMatch[1]}`, under_odds: w, over_odds: l };
  }
  if (suffix.includes('홀/짝')) {
    return { combo_no: n, type: 'sum', label: '홀/짝 SUM', line_value: null, odd_odds: w, even_odds: l };
  }
  if (suffix.includes('승1패')) {
    return { combo_no: n, type: 'handicap', label: '핸디캡 승1패', line_value: '승1패', home_odds: w, draw_odds: d, away_odds: l };
  }
  return { combo_no: n, type: 'match_winner', label: '승무패', line_value: null, home_odds: w, draw_odds: d, away_odds: l };
}

// ── 행 그룹화 (같은 팀 + 같은 일시 = 한 경기) ──────────────────
function groupRows(rows: ZentotoRow[]): MatchGroup[] {
  const groups: MatchGroup[] = [];

  for (const row of rows) {
    const dtClean = row.datetimeRaw.replace(/ \([^)]+\)/, '');
    const matchDate = new Date(dtClean.replace(' ', 'T') + ':00+09:00').toISOString();
    const betRow = makeBetRow(row);

    const existing = groups.find(
      g => g.baseName === row.baseName && g.awayName === row.awayName && g.matchDate === matchDate,
    );
    if (existing) {
      // 홀/짝(sum)이 이미 등장한 이후의 콤보 = 5회(전반전) 베팅
      const hasSumAlready = existing.betTypes.some(b => b.type === 'sum');
      if (hasSumAlready) {
        if (betRow.type === 'match_winner') {
          betRow.type = 'ht_match_winner'; betRow.label = '5회 ' + betRow.label;
        } else if (betRow.type === 'handicap') {
          betRow.type = 'ht_handicap'; betRow.label = '5회 ' + betRow.label;
        } else if (betRow.type === 'under_over') {
          betRow.type = 'ht_under_over'; betRow.label = '5회 ' + betRow.label;
        }
      } else if (betRow.type === 'under_over') {
        // sum 없이도 U/O 라인 ≤ 6.0이면 야구 5회 언더오버
        const lineNum = parseFloat((betRow.line_value ?? '').replace(/[^0-9.]/g, '') || '99');
        const alreadyHasUO = existing.betTypes.some(b => b.type === 'under_over');
        if (alreadyHasUO && lineNum <= 6.0) {
          betRow.type = 'ht_under_over'; betRow.label = '5회 ' + betRow.label;
        }
      }
      existing.betTypes.push(betRow);
    } else {
      groups.push({ baseNo: parseInt(row.no), round: row.round, matchDate, baseName: row.baseName, awayName: row.awayName, betTypes: [betRow] });
    }
  }
  return groups;
}

// ── 리그 추정 (핸디캡 라인 크기로 종목 구분) ─────────────────────
function guessLeague(group: MatchGroup): string {
  const hn = group.baseName;
  if (hn.includes('_남자') || hn.includes('_여자')) return '농구';
  const hc = group.betTypes.find(b => b.type === 'handicap');
  if (hc?.line_value) {
    const num = parseFloat(hc.line_value.replace(/[^0-9.]/g, '') || '0');
    if (num >= 5) return '농구';
    if (num >= 2) return '야구';
  }
  return '기타';
}

// ── DB 저장 ────────────────────────────────────────────────
async function saveGroups(groups: MatchGroup[]) {
  let saved = 0, skipped = 0;
  const errors: string[] = [];

  for (const group of groups) {
    try {
      const league_name = guessLeague(group);
      const league_id  = await findOrCreateLeague(league_name);
      const home_id    = await findOrCreateTeam(group.baseName, league_id);
      const away_id    = await findOrCreateTeam(group.awayName, league_id);

      if (!home_id || !away_id) { skipped++; continue; }

      const betman_id = `zentoto-${group.baseNo}`;
      const { data: match, error: me } = await supabase.from('matches').upsert({
        betman_id,
        betman_game_no: group.baseNo,
        betman_round:   group.round || null,
        league_id,
        home_team_id:   home_id,
        away_team_id:   away_id,
        match_date:     group.matchDate,
        status:         'scheduled',
        mapping_status: 'manual',
      }, { onConflict: 'betman_id' }).select('id');

      if (me) throw me;
      const match_id = match?.[0]?.id;
      if (!match_id) { skipped++; continue; }

      // 기존 zentoto 배당 삭제 후 재삽입
      await supabase.from('odds_history').delete().eq('match_id', match_id).eq('provider', 'zentoto');

      const oddsRows = group.betTypes.map(bt => ({
        match_id,
        provider:        'zentoto',
        bet_type:        bt.type,
        betman_combo_no: bt.combo_no,
        bet_label:       bt.label,
        line_value:      bt.line_value ?? null,
        home_odds:       bt.home_odds  ?? null,
        draw_odds:       bt.draw_odds  ?? null,
        away_odds:       bt.away_odds  ?? null,
        under_odds:      bt.under_odds ?? null,
        over_odds:       bt.over_odds  ?? null,
        odd_odds:        bt.odd_odds   ?? null,
        even_odds:       bt.even_odds  ?? null,
      }));
      await supabase.from('odds_history').insert(oddsRows);
      saved++;
    } catch (e) {
      errors.push(String(e));
      skipped++;
    }
  }
  return { saved, skipped, total: groups.length, errors: errors.slice(0, 5) };
}

// ── HTML 파서 (서버사이드 렌더링인 경우) ─────────────────────────
function parseHtml(html: string): ZentotoRow[] {
  const now = new Date();
  const parsed: ZentotoRow[] = [];

  const trRegex = /<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/g;
  let m;
  while ((m = trRegex.exec(html)) !== null) {
    const tr = m[0];
    if (tr.includes('<th')) continue;

    const noMatch = tr.match(/class="text-center"[^>]*>(\d{4,5})<\/td>/);
    if (!noMatch) continue;
    const no = noMatch[1];

    const dtMatch = tr.match(/(\d{4}-\d{2}-\d{2} \([^)]+\) \d{2}:\d{2})/);
    if (!dtMatch) continue;
    const datetimeRaw = dtMatch[1];

    const dtClean = datetimeRaw.replace(/ \([^)]+\)/, '');
    const matchDate = new Date(dtClean.replace(' ', 'T') + ':00+09:00');
    if (matchDate <= now) continue;

    const roundMatch = tr.match(/analizer\('\/(\d+)\/\d+'\)/);
    const round = roundMatch?.[1] ?? '';

    const homeDiv = tr.match(/<div class="col-6 text-right">([\s\S]*?)<\/div>/);
    if (!homeDiv) continue;
    const spans = [...homeDiv[1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)];
    const baseName = spans[0]?.[1]?.trim() ?? '';
    const suffix   = spans[1]?.[1]?.trim() ?? '';

    const awayDiv = tr.match(/<div class="col-4 text-left">([\s\S]*?)<\/div>/);
    const awaySpan = awayDiv?.[1].match(/<span[^>]*>([^<]*)<\/span>/);
    const awayName = awaySpan?.[1]?.trim() ?? '';

    const payAll = [...tr.matchAll(/\bpay="([\d.]+)"/g)];
    const payW = payAll[0]?.[1] ?? '0';
    const payD = payAll[1]?.[1] ?? '0';
    const payL = payAll[2]?.[1] ?? '0';
    const betCntM = tr.match(/bet-cnt="(\d)"/);
    const betCnt = betCntM?.[1] ?? '2';

    if (baseName && awayName) {
      parsed.push({ no, round, datetimeRaw, baseName, suffix, awayName, betCnt, payW, payD, payL });
    }
  }
  return parsed;
}

// ── GET: 서버사이드 수집 ────────────────────────────────────
export async function GET() {
  try {
    const res = await fetch('https://www.zentoto.com/proto/mixer', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.zentoto.com/',
      },
      cache: 'no-store',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const rows   = parseHtml(html);
    if (rows.length === 0) {
      // JS 렌더링 페이지일 경우 클라이언트 fallback 안내
      return NextResponse.json({ error: 'JS_RENDER', message: '서버측 파싱 실패. 브라우저 수집 버튼을 이용하세요.' }, { status: 422 });
    }

    const groups = groupRows(rows);
    const result = await saveGroups(groups);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[Zentoto GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: 클라이언트가 브라우저에서 추출한 rows를 전달 ──────────
export async function POST(req: Request) {
  try {
    const { rows }: { rows: ZentotoRow[] } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: '데이터 없음' }, { status: 400 });
    }
    const groups = groupRows(rows);
    const result = await saveGroups(groups);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[Zentoto POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

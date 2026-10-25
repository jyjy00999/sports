/**
 * GET  /api/matches/zentoto  — 젠토토 사이트에서 미시작 경기 수집 후 DB 저장
 * POST /api/matches/zentoto  — 브라우저가 직접 추출한 rows 배열을 받아 DB 저장 (SSR 실패 시 fallback)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { detectSport, parseLineNumber, parseMarginThreshold, SPORT_RULES, type SportKey } from '@/lib/sports-rules';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

/**
 * DB 도달 가능 여부를 먼저 확인한다.
 * 이게 없으면 경기 수십 건마다 DNS 재시도가 반복돼 수집이 수 분간 멈춘다.
 */
async function assertDbReachable(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sports?select=id&limit=1`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Supabase 인증 실패 — SUPABASE_SERVICE_KEY를 확인하세요.');
    }
    if (res.status === 404) {
      throw new Error('sports 테이블이 없습니다 — supabase/schema.sql 을 SQL Editor에서 실행하세요.');
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/abort|timeout/i.test(msg)) {
      throw new Error(`Supabase 응답 시간 초과 (8초). 프로젝트가 일시정지되었는지 확인하세요.`);
    }
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
      const host = (() => { try { return new URL(process.env.SUPABASE_URL!).host; } catch { return process.env.SUPABASE_URL; } })();
      throw new Error(`Supabase 서버에 연결할 수 없습니다 (${host}). 프로젝트가 삭제되었거나 URL이 잘못되었습니다.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── 리그/팀 생성 헬퍼 ──────────────────────────────────────
async function findOrCreateLeague(name_kr: string, sportKey: SportKey = 'soccer') {
  const { data } = await supabase.from('leagues').select('id').eq('name_kr', name_kr).limit(1);
  if (data?.length) return data[0].id;
  // 종목 레코드 확보 (없으면 생성) — 기존에는 무조건 soccer로 넣어 농구/배구/야구가 축구로 분류되던 버그
  const nameKrOfSport = SPORT_RULES[sportKey].name;
  let sport_id: string | null = null;
  const found = await supabase.from('sports').select('id').eq('name_en', sportKey).limit(1);
  if (found.data?.length) {
    sport_id = found.data[0].id;
  } else {
    const created = await supabase.from('sports').insert({ name_en: sportKey, name_kr: nameKrOfSport }).select('id');
    sport_id = created.data?.[0]?.id ?? null;
  }
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
  /** 같은 경기의 조합들이 공유하는 id (젠토토 proto-pid) */
  parentId?: string;
  /** 젠토토 공식 유형 코드: N/H/U/S/W1L/W5L */
  betTypeCode?: string;
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
  /** 젠토토 proto-pid — 같은 경기의 조합을 묶는 키 */
  parentId?: string;
  baseNo: number;
  round: string;
  matchDate: string;  // ISO
  baseName: string;
  awayName: string;
  betTypes: BetRow[];
};

// ── 베팅 유형 매핑 ──────────────────────────────────────────
function makeBetRow(row: ZentotoRow): BetRow {
  const { suffix, payW, payD, payL, no, betTypeCode } = row;
  const w = parseFloat(payW) > 0 ? parseFloat(payW) : null;
  const d = parseFloat(payD) > 0 ? parseFloat(payD) : null;
  const l = parseFloat(payL) > 0 ? parseFloat(payL) : null;
  const n = parseInt(no);

  // ── 젠토토 공식 유형 코드 우선 (한글 suffix 추측보다 정확) ──
  //    N=승무패 / H=핸디캡 / U=언더오버 / S=홀짝 / W1L=승1패 / W5L=승5패
  if (betTypeCode) {
    const line = suffix.replace(/^\(|\)$/g, '').trim();
    switch (betTypeCode) {
      case 'N':
        return { combo_no: n, type: 'match_winner', label: '승무패', line_value: null, home_odds: w, draw_odds: d, away_odds: l };
      case 'H':
        return { combo_no: n, type: 'handicap', label: `핸디캡 ${line}`, line_value: line, home_odds: w, draw_odds: d, away_odds: l };
      case 'U': {
        const uo = line.match(/U\/O\s*([\d.]+)/i);
        const lv = uo ? `U/O ${uo[1]}` : line;
        return { combo_no: n, type: 'under_over', label: `언더오버 ${lv}`, line_value: lv, under_odds: w, over_odds: l };
      }
      case 'S':
        return { combo_no: n, type: 'sum', label: '홀/짝 SUM', line_value: null, odd_odds: w, even_odds: l };
      case 'W1L':
        return { combo_no: n, type: 'margin', label: '승1패', line_value: '승1패', home_odds: w, draw_odds: d, away_odds: l };
      case 'W5L':
        return { combo_no: n, type: 'margin', label: '승5패', line_value: '승5패', home_odds: w, draw_odds: d, away_odds: l };
    }
  }

  // ── 코드가 없을 때만 한글 suffix로 추정 (구버전 HTML 대비) ──
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
  // 승1패(야구) / 승5패(농구) — 핸디캡이 아니라 '점수차 이내' 마진 유형
  const marginMatch = suffix.match(/승\s*(\d+)\s*패/);
  if (marginMatch) {
    const t = marginMatch[1];
    return { combo_no: n, type: 'margin', label: `승${t}패`, line_value: `승${t}패`, home_odds: w, draw_odds: d, away_odds: l };
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

    // 같은 경기 판별: proto-pid가 있으면 그것을 신뢰하고, 없으면 팀명+시각으로 대체
    const existing = row.parentId
      ? groups.find(g => g.parentId === row.parentId)
      : groups.find(
          g => g.baseName === row.baseName && g.awayName === row.awayName && g.matchDate === matchDate,
        );
    if (existing) {
      // 홀/짝(sum)이 이미 등장한 이후의 콤보 = 전반 베팅
      const hasSumAlready = existing.betTypes.some(b => b.type === 'sum');
      // 야구는 '5회', 그 외 종목은 '전반'으로 표기
      const pre = existing.betTypes.some(b => b.type === 'margin' && /승\s*1\s*패/.test(b.line_value ?? ''))
        ? '5회 ' : '전반 ';
      if (hasSumAlready) {
        if (betRow.type === 'match_winner') {
          betRow.type = 'ht_match_winner'; betRow.label = pre + betRow.label;
        } else if (betRow.type === 'margin') {
          // 젠토토는 전반 승무패에도 (승1패) suffix를 재사용한다.
          // 전반 상품은 승무패/핸디캡/언더오버 3종뿐이고 전반 승1패는 존재하지 않으므로
          // 홀/짝 이후에 나온 3지선다는 전반 승무패로 처리한다.
          betRow.type = 'ht_match_winner';
          betRow.label = pre + '승무패';
          betRow.line_value = null;
        } else if (betRow.type === 'handicap') {
          betRow.type = 'ht_handicap'; betRow.label = pre + betRow.label;
        } else if (betRow.type === 'under_over') {
          betRow.type = 'ht_under_over'; betRow.label = pre + betRow.label;
        }
      } else if (betRow.type === 'under_over') {
        // sum 없이도 U/O 라인 ≤ 6.0이면 야구 5회 언더오버
        const lineNum = parseFloat((betRow.line_value ?? '').replace(/[^0-9.]/g, '') || '99');
        const alreadyHasUO = existing.betTypes.some(b => b.type === 'under_over');
        if (alreadyHasUO && lineNum <= 6.0) {
          betRow.type = 'ht_under_over'; betRow.label = pre + betRow.label;
        }
      }
      existing.betTypes.push(betRow);
    } else {
      groups.push({ baseNo: parseInt(row.no), parentId: row.parentId, round: row.round, matchDate, baseName: row.baseName, awayName: row.awayName, betTypes: [betRow] });
    }
  }
  return groups;
}

// ── 종목 추정 (언더오버 라인 > 팀명 > 핸디캡 라인 순으로 판정) ──────
function guessSport(group: MatchGroup): SportKey {
  const hn = group.baseName;
  // 젠토토 농구 표기: 팀명에 _남자/_여자 접미사
  if (hn.includes('_남자') || hn.includes('_여자')) return 'basketball';

  const uo = group.betTypes.find(b => b.type === 'under_over');
  const hc = group.betTypes.find(b => b.type === 'handicap');
  const mg = group.betTypes.find(b => b.type === 'margin');

  return detectSport({
    homeName: group.baseName,
    awayName: group.awayName,
    totalLine: parseLineNumber(uo?.line_value),
    handicapLine: hc?.line_value ? Math.abs(parseLineNumber(hc.line_value) ?? 0) : null,
    marginThreshold: parseMarginThreshold(mg?.line_value),
  });
}

function guessLeague(group: MatchGroup): string {
  return SPORT_RULES[guessSport(group)].name;
}

// ── DB 저장 ────────────────────────────────────────────────
async function saveGroups(groups: MatchGroup[]) {
  let saved = 0, skipped = 0;
  const errors: string[] = [];

  // DB가 죽어 있으면 즉시 중단 (경기마다 DNS 재시도로 수 분 멈추는 것 방지)
  await assertDbReachable();

  for (const group of groups) {
    try {
      const sportKey   = guessSport(group);
      const league_name = guessLeague(group);
      const league_id  = await findOrCreateLeague(league_name, sportKey);
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

    // 조합번호: 회차가 바뀌면 자릿수가 달라진다(3자리~5자리). proto-uid를 우선 사용.
    const uidMatch = tr.match(/proto-uid="(\d+)"/);
    const noMatch = uidMatch ?? tr.match(/class="text-center"[^>]*>(\d{2,6})<\/td>/);
    if (!noMatch) continue;
    const no = noMatch[1];

    // 같은 경기의 조합들은 proto-pid를 공유한다 (팀명+시각 매칭보다 정확)
    const pidMatch = tr.match(/proto-pid="(\d+)"/);
    const parentId = pidMatch?.[1] ?? '';

    // 젠토토가 제공하는 공식 유형 코드
    //   N=승무패 H=핸디캡 U=언더오버 S=홀짝 W1L=승1패(야구) W5L=승5패(농구)
    const btMatch = tr.match(/bet-type="([A-Z0-9]+)"/);
    const betTypeCode = btMatch?.[1] ?? '';

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
      parsed.push({ no, parentId, betTypeCode, round, datetimeRaw, baseName, suffix, awayName, betCnt, payW, payD, payL });
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
    return NextResponse.json({ error: (err as Error)?.message ?? String(err) }, { status: 500 });
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
    return NextResponse.json({ error: (err as Error)?.message ?? String(err) }, { status: 500 });
  }
}

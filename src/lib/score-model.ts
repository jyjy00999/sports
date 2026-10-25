/**
 * 예상 스코어 분포 → 모든 베팅 유형 확률 계산
 *
 * 설계 원칙: AI는 "각 스코어가 나올 확률"만 예측하고,
 * 승무패·핸디캡·언더오버·홀짝·마진 확률은 전부 이 분포에서 기계적으로 계산한다.
 * 이렇게 하면 유형 간 모순이 구조적으로 불가능해진다.
 */

export interface ScoreProb {
  home: number;
  away: number;
  /** 해당 스코어가 나올 확률(%) */
  prob: number;
}

export interface DerivedMarkets {
  // 승무패
  home_win_pct: number;
  draw_pct: number;
  away_win_pct: number;
  // 핸디캡
  handicap_home_pct: number;
  handicap_draw_pct: number;
  handicap_away_pct: number;
  // 언더오버
  under_pct: number;
  over_pct: number;
  // 홀짝
  odd_pct: number;
  even_pct: number;
  // 마진 (승1패 / 승5패)
  margin_home_pct: number;
  margin_mid_pct: number;
  margin_away_pct: number;
  /** 가장 가능성 높은 단일 스코어 */
  expected_score: string;
  /** 예상 스코어가 각 유형에서 어느 항목에 해당하는지 */
  implied: {
    match_winner: 'home' | 'draw' | 'away';
    handicap: 'home' | 'draw' | 'away' | null;
    under_over: 'under' | 'over' | null;
    sum: 'odd' | 'even';
    margin: 'home' | 'mid' | 'away' | null;
  };
}

/** 분포 합계를 100으로 정규화하고 비정상 항목 제거 */
export function normalizeDistribution(dist: ScoreProb[]): ScoreProb[] {
  const clean = dist.filter(
    d =>
      Number.isFinite(d.home) && Number.isFinite(d.away) && Number.isFinite(d.prob) &&
      d.home >= 0 && d.away >= 0 && d.prob > 0,
  );
  const total = clean.reduce((s, d) => s + d.prob, 0);
  if (total <= 0) return [];
  return clean.map(d => ({ ...d, prob: (d.prob / total) * 100 }));
}

const pct = (v: number) => Math.round(v);

/** 반올림 오차로 합계가 100을 벗어나면 가장 큰 항목에서 보정 */
function fixTo100(parts: number[]): number[] {
  const rounded = parts.map(pct);
  const diff = 100 - rounded.reduce((a, b) => a + b, 0);
  if (diff === 0) return rounded;
  let idx = 0;
  for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[idx]) idx = i;
  rounded[idx] += diff;
  return rounded;
}

/**
 * 핸디캡 적용 결과 판정.
 * handicapValue는 홈팀 점수에 더해지는 값 (H+2.5 → +2.5, H-1.0 → -1.0)
 */
function handicapOutcome(home: number, away: number, h: number): 'home' | 'draw' | 'away' {
  const adjusted = home + h;
  if (adjusted > away) return 'home';
  if (adjusted < away) return 'away';
  return 'draw'; // 정수 핸디캡에서만 발생 (.5 라인은 구조상 불가)
}

/**
 * 마진 유형(승1패/승5패) 판정.
 * threshold 이내 점수차면 중간, 그보다 크면 승/패
 */
function marginOutcome(home: number, away: number, t: number): 'home' | 'mid' | 'away' {
  const diff = home - away;
  if (diff > t) return 'home';
  if (diff < -t) return 'away';
  return 'mid';
}

export function deriveMarkets(
  rawDist: ScoreProb[],
  opts: {
    /** 홈팀 점수에 더해지는 핸디캡 값 (없으면 null) */
    handicapValue?: number | null;
    /** 언더오버 기준선 (없으면 null) */
    totalLine?: number | null;
    /** 마진 임계값: 승1패=1, 승5패=5 (없으면 null) */
    marginThreshold?: number | null;
    /** 무승부가 성립하는 종목인가 (축구만 true) */
    hasDraw: boolean;
  },
): DerivedMarkets | null {
  const dist = normalizeDistribution(rawDist);
  if (dist.length === 0) return null;

  const { handicapValue, totalLine, marginThreshold, hasDraw } = opts;

  let hw = 0, dr = 0, aw = 0;
  let hcH = 0, hcD = 0, hcA = 0;
  let under = 0, over = 0;
  let odd = 0, even = 0;
  let mgH = 0, mgM = 0, mgA = 0;

  for (const s of dist) {
    const p = s.prob;
    const total = s.home + s.away;

    // 승무패
    if (s.home > s.away) hw += p;
    else if (s.home < s.away) aw += p;
    else dr += p;

    // 핸디캡
    if (handicapValue != null) {
      const o = handicapOutcome(s.home, s.away, handicapValue);
      if (o === 'home') hcH += p;
      else if (o === 'away') hcA += p;
      else hcD += p;
    }

    // 언더오버 (라인은 항상 .5이므로 push 없음)
    if (totalLine != null) {
      if (total > totalLine) over += p;
      else under += p;
    }

    // 홀짝
    if (total % 2 === 1) odd += p;
    else even += p;

    // 마진
    if (marginThreshold != null) {
      const o = marginOutcome(s.home, s.away, marginThreshold);
      if (o === 'home') mgH += p;
      else if (o === 'away') mgA += p;
      else mgM += p;
    }
  }

  // 무승부가 없는 종목인데 분포에 동점이 섞여 있으면 홈/원정에 비례 배분
  if (!hasDraw && dr > 0) {
    const base = hw + aw;
    if (base > 0) {
      hw += dr * (hw / base);
      aw += dr * (aw / base);
    } else {
      hw += dr / 2;
      aw += dr / 2;
    }
    dr = 0;
  }

  const [hwR, drR, awR] = fixTo100([hw, dr, aw]);
  const [hcHR, hcDR, hcAR] = handicapValue != null ? fixTo100([hcH, hcD, hcA]) : [0, 0, 0];
  const [underR, overR] = totalLine != null ? fixTo100([under, over]) : [0, 0];
  const [oddR, evenR] = fixTo100([odd, even]);
  const [mgHR, mgMR, mgAR] = marginThreshold != null ? fixTo100([mgH, mgM, mgA]) : [0, 0, 0];

  // 최빈 스코어
  const mode = dist.reduce((best, s) => (s.prob > best.prob ? s : best), dist[0]);
  const modeTotal = mode.home + mode.away;

  return {
    home_win_pct: hwR,
    draw_pct: drR,
    away_win_pct: awR,
    handicap_home_pct: hcHR,
    handicap_draw_pct: hcDR,
    handicap_away_pct: hcAR,
    under_pct: underR,
    over_pct: overR,
    odd_pct: oddR,
    even_pct: evenR,
    margin_home_pct: mgHR,
    margin_mid_pct: mgMR,
    margin_away_pct: mgAR,
    expected_score: `${mode.home}-${mode.away}`,
    implied: {
      match_winner: mode.home > mode.away ? 'home' : mode.home < mode.away ? 'away' : 'draw',
      handicap: handicapValue != null ? handicapOutcome(mode.home, mode.away, handicapValue) : null,
      under_over: totalLine != null ? (modeTotal > totalLine ? 'over' : 'under') : null,
      sum: modeTotal % 2 === 1 ? 'odd' : 'even',
      margin: marginThreshold != null ? marginOutcome(mode.home, mode.away, marginThreshold) : null,
    },
  };
}

// ── 베팅 항목 순위 산출 (추천 선정용) ──────────────────────────

export interface RankedOption {
  betType: string;
  /** 표시용 라벨 (예: '언더', '홈 승', '1점차 이내') */
  label: string;
  /** 유형 설명 (예: '언더오버 U/O 2.5') */
  typeLabel: string;
  pct: number;
  odds: number;
  /** 예상 스코어가 이 항목을 가리키는가 */
  isExpected: boolean;
}

interface ComboLike {
  bet_type: string;
  bet_label?: string;
  line_value?: string | null;
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  under_odds?: number | null;
  over_odds?: number | null;
  odd_odds?: number | null;
  even_odds?: number | null;
}

/**
 * 실제 발매된 베팅 조합들에 대해 확률 순위를 매긴다.
 * 배당이 없는 항목(걸 수 없는 칸)은 제외한다.
 * 정렬: 확률 내림차순 -> 예상 스코어 일치 -> 배당 낮은 순
 */
export function rankOptions(d: DerivedMarkets, combos: ComboLike[]): RankedOption[] {
  const out: RankedOption[] = [];
  const push = (
    betType: string, typeLabel: string, label: string,
    pct: number, odds: number | null | undefined, isExpected: boolean,
  ) => {
    if (odds == null || !Number.isFinite(odds) || odds <= 0) return;
    if (!Number.isFinite(pct) || pct <= 0) return;
    out.push({ betType, label, typeLabel, pct, odds, isExpected });
  };

  for (const c of combos) {
    const tl = c.bet_label ?? c.bet_type;
    switch (c.bet_type) {
      case 'match_winner':
        push(c.bet_type, tl, '홈 승', d.home_win_pct, c.home_odds, d.implied.match_winner === 'home');
        push(c.bet_type, tl, '무승부', d.draw_pct, c.draw_odds, d.implied.match_winner === 'draw');
        push(c.bet_type, tl, '원정 승', d.away_win_pct, c.away_odds, d.implied.match_winner === 'away');
        break;
      case 'handicap':
        push(c.bet_type, tl, '핸디 홈 승', d.handicap_home_pct, c.home_odds, d.implied.handicap === 'home');
        push(c.bet_type, tl, '핸디 무', d.handicap_draw_pct, c.draw_odds, d.implied.handicap === 'draw');
        push(c.bet_type, tl, '핸디 원정 승', d.handicap_away_pct, c.away_odds, d.implied.handicap === 'away');
        break;
      case 'margin': {
        const t = parseInt((c.line_value ?? '').match(/승\s*(\d+)\s*패/)?.[1] ?? '1', 10);
        push(c.bet_type, tl, `${t + 1}점차+ 홈 승`, d.margin_home_pct, c.home_odds, d.implied.margin === 'home');
        push(c.bet_type, tl, `${t}점차 이내`, d.margin_mid_pct, c.draw_odds, d.implied.margin === 'mid');
        push(c.bet_type, tl, `${t + 1}점차+ 원정 승`, d.margin_away_pct, c.away_odds, d.implied.margin === 'away');
        break;
      }
      case 'under_over':
        push(c.bet_type, tl, '언더', d.under_pct, c.under_odds, d.implied.under_over === 'under');
        push(c.bet_type, tl, '오버', d.over_pct, c.over_odds, d.implied.under_over === 'over');
        break;
      case 'sum':
        push(c.bet_type, tl, '홀', d.odd_pct, c.odd_odds, d.implied.sum === 'odd');
        push(c.bet_type, tl, '짝', d.even_pct, c.even_odds, d.implied.sum === 'even');
        break;
      // 전반(ht_*)은 분포로 계산되지 않으므로 추천 후보에서 제외
    }
  }

  out.sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1;
    return a.odds - b.odds;
  });
  return out;
}

// ── 고득점 종목(농구·배구)용: 점수차 + 총점 분포 ──────────────────
// 농구는 90~130점대라 "정확한 스코어" 8~14개로는 분포를 담을 수 없다.
// (몇 개가 전부 한쪽으로 쏠려 승률 100% 같은 값이 나온다)
// 대신 베팅 시장이 실제로 쓰는 두 축 — 점수차와 총점 — 을 직접 받는다.

export interface MarginProb {
  /** 홈 점수 - 원정 점수 */
  diff: number;
  prob: number;
}
export interface TotalProb {
  /** 양팀 점수 합 */
  total: number;
  prob: number;
}

function normalize<T extends { prob: number }>(arr: T[]): T[] {
  const clean = arr.filter(x => Number.isFinite(x.prob) && x.prob > 0);
  const sum = clean.reduce((s, x) => s + x.prob, 0);
  if (sum <= 0) return [];
  return clean.map(x => ({ ...x, prob: (x.prob / sum) * 100 }));
}

export function deriveFromMarginTotal(
  rawMargins: MarginProb[],
  rawTotals: TotalProb[],
  opts: {
    handicapValue?: number | null;
    totalLine?: number | null;
    marginThreshold?: number | null;
    hasDraw: boolean;
  },
): DerivedMarkets | null {
  const margins = normalize(rawMargins.filter(m => Number.isFinite(m.diff)));
  const totals = normalize(rawTotals.filter(t => Number.isFinite(t.total) && t.total >= 0));
  if (margins.length === 0 || totals.length === 0) return null;

  const { handicapValue, totalLine, marginThreshold, hasDraw } = opts;

  let hw = 0, dr = 0, aw = 0;
  let hcH = 0, hcD = 0, hcA = 0;
  let mgH = 0, mgM = 0, mgA = 0;

  for (const m of margins) {
    const p = m.prob;
    if (m.diff > 0) hw += p;
    else if (m.diff < 0) aw += p;
    else dr += p;

    if (handicapValue != null) {
      const adj = m.diff + handicapValue;
      if (adj > 0) hcH += p;
      else if (adj < 0) hcA += p;
      else hcD += p;
    }
    if (marginThreshold != null) {
      if (m.diff > marginThreshold) mgH += p;
      else if (m.diff < -marginThreshold) mgA += p;
      else mgM += p;
    }
  }

  let under = 0, over = 0, odd = 0, even = 0;
  for (const t of totals) {
    const p = t.prob;
    if (totalLine != null) {
      if (t.total > totalLine) over += p;
      else under += p;
    }
    if (t.total % 2 === 1) odd += p;
    else even += p;
  }

  // 무승부가 없는 종목인데 동점이 섞이면 홈/원정에 비례 배분
  if (!hasDraw && dr > 0) {
    const base = hw + aw;
    if (base > 0) { hw += dr * (hw / base); aw += dr * (aw / base); }
    else { hw += dr / 2; aw += dr / 2; }
    dr = 0;
  }

  const [hwR, drR, awR] = fixTo100([hw, dr, aw]);
  const [hcHR, hcDR, hcAR] = handicapValue != null ? fixTo100([hcH, hcD, hcA]) : [0, 0, 0];
  const [underR, overR] = totalLine != null ? fixTo100([under, over]) : [0, 0];
  const [oddR, evenR] = fixTo100([odd, even]);
  const [mgHR, mgMR, mgAR] = marginThreshold != null ? fixTo100([mgH, mgM, mgA]) : [0, 0, 0];

  // 대표 스코어: 최빈 점수차와 최빈 총점을 조합
  const modeM = margins.reduce((b, x) => (x.prob > b.prob ? x : b), margins[0]);
  const modeT = totals.reduce((b, x) => (x.prob > b.prob ? x : b), totals[0]);
  const homeScore = Math.round((modeT.total + modeM.diff) / 2);
  const awayScore = Math.round((modeT.total - modeM.diff) / 2);
  const repTotal = homeScore + awayScore;
  const repDiff = homeScore - awayScore;

  return {
    home_win_pct: hwR, draw_pct: drR, away_win_pct: awR,
    handicap_home_pct: hcHR, handicap_draw_pct: hcDR, handicap_away_pct: hcAR,
    under_pct: underR, over_pct: overR,
    odd_pct: oddR, even_pct: evenR,
    margin_home_pct: mgHR, margin_mid_pct: mgMR, margin_away_pct: mgAR,
    expected_score: `${homeScore}-${awayScore}`,
    implied: {
      match_winner: repDiff > 0 ? 'home' : repDiff < 0 ? 'away' : 'draw',
      handicap: handicapValue != null
        ? (repDiff + handicapValue > 0 ? 'home' : repDiff + handicapValue < 0 ? 'away' : 'draw')
        : null,
      under_over: totalLine != null ? (repTotal > totalLine ? 'over' : 'under') : null,
      sum: repTotal % 2 === 1 ? 'odd' : 'even',
      margin: marginThreshold != null
        ? (repDiff > marginThreshold ? 'home' : repDiff < -marginThreshold ? 'away' : 'mid')
        : null,
    },
  };
}

/** 이 종목이 점수차+총점 모델을 써야 하는가 (고득점 종목) */
export function usesMarginTotalModel(sportKey: string): boolean {
  return sportKey === 'basketball' || sportKey === 'volleyball';
}

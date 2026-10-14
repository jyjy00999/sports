/**
 * 종목별 베팅 규정 (스포츠토토 프로토 승부식 공식 규정 기준)
 * 출처: https://www.sportstoto.co.kr/proto_rules.php
 *       https://www.sportstoto.co.kr/basket_victory.php (승5패)
 *       2025 프로토 승부식 야구 전반 상품 발매 안내 (notice idx=2680)
 */

export type SportKey = 'soccer' | 'baseball' | 'basketball' | 'volleyball';

export interface SportRule {
  key: SportKey;
  name: string;
  /** 승무패에 '무' 항목이 존재하는가 (축구만 true) */
  hasDraw: boolean;
  /** 대상경기 적용 시간 기준 */
  timeBasis: string;
  /** 전반 상품 기준 (없으면 null) */
  halfBasis: string | null;
  /** 마진 유형 (야구 승1패 / 농구 승5패). 없으면 null */
  margin: { label: string; threshold: number; desc: string } | null;
  /** 핸디캡 기준 단위 */
  handicapUnit: '점수' | '세트스코어';
  /** 언더오버 기준 단위 */
  totalUnit: string;
  /** 전형적인 U/O 라인 범위 [최소, 최대] — 종목 자동감지에 사용 */
  totalRange: [number, number];
  /** 무승부 처리 방식 */
  drawHandling: string;
}

export const SPORT_RULES: Record<SportKey, SportRule> = {
  soccer: {
    key: 'soccer',
    name: '축구',
    hasDraw: true,
    timeBasis: '전반+후반(정규 90분)까지의 결과. 연장전과 승부차기는 제외',
    halfBasis: '전반 45분 종료 시점',
    margin: null,
    handicapUnit: '점수',
    totalUnit: '양팀 득점 합계',
    totalRange: [0.5, 4.5],
    drawHandling: '무승부 배당이 존재하므로 draw_pct > 0 가능',
  },
  baseball: {
    key: 'baseball',
    name: '야구',
    hasDraw: false,
    timeBasis: '경기 시작부터 최종 종료까지(연장전·승부치기 포함). 더블헤더는 먼저 열리는 1차전만 적용',
    halfBasis: '5회(이닝) 종료 시점',
    margin: {
      label: '승1패',
      threshold: 1,
      desc: '승=홈팀 2점차 이상 승리 / 1=1점차 이내 승부(무승부 포함) / 패=홈팀 2점차 이상 패배',
    },
    handicapUnit: '점수',
    totalUnit: '양팀 득점 합계',
    totalRange: [5.5, 13.5],
    drawHandling: '무승부 배당 없음 → draw_pct는 반드시 0. 실제 무승부 시 승·패 배당 모두 1.0배 환급',
  },
  basketball: {
    key: 'basketball',
    name: '농구',
    hasDraw: false,
    timeBasis: '연장전을 포함한 최종 결과',
    halfBasis: '전반(1~2쿼터) 종료 시점',
    margin: {
      label: '승5패',
      threshold: 5,
      desc: '승=홈팀 6점차 이상 승리 / 5=5점차 이내 승부 / 패=홈팀 6점차 이상 패배',
    },
    handicapUnit: '점수',
    totalUnit: '양팀 득점 합계',
    totalRange: [120.5, 250.5],
    drawHandling: '무승부 배당 없음(연장으로 승부 결정) → draw_pct는 반드시 0',
  },
  volleyball: {
    key: 'volleyball',
    name: '배구',
    hasDraw: false,
    timeBasis: '최종 결과',
    halfBasis: null,
    margin: null,
    handicapUnit: '세트스코어',
    totalUnit: '세트 득점이 아닌 전 세트 총 득점 합계',
    totalRange: [150.5, 220.5],
    drawHandling: '무승부 없음(반드시 승패 결정) → draw_pct는 반드시 0',
  },
};

// ── 리그/팀명 키워드 ───────────────────────────────────────────
const LEAGUE_KEYWORDS: Array<[SportKey, string[]]> = [
  ['baseball', ['MLB', 'KBO', 'NPB', '야구', '메이저리그', '퍼시픽', '센트럴', '프로야구']],
  ['basketball', ['NBA', 'KBL', 'WKBL', '농구', '프로농구', '유로리그']],
  ['volleyball', ['KOVO', '배구', '프로배구', 'V리그', 'V-리그']],
  ['soccer', ['축구', 'EPL', '프리미어', '라리가', '분데스', '세리에', '리그앙', 'K리그', 'UCL', '챔피언스']],
];

// NPB/KBO 구단 키워드 (리그명이 '기타'로 들어오는 경우 대비)
const BASEBALL_TEAM_HINTS = [
  '드래건스', '드래곤스', '주니치', '추니치', '카프', '도요카프', '히로시마',
  '자이언츠', '타이거즈', '타이거스', '베이스타즈', '스왈로즈', '스왈로우즈',
  '호크스', '파이터즈', '버팔로즈', '이글스', '라이온즈', '마린즈',
  '라쿠텐', '세이부', '롯데', '야쿠르트', '한신', '요미우리', '소프트뱅크',
  '니혼햄', '오릭스', '베어스', '위즈', '다이노스', '랜더스', '히어로즈',
];

// 주의: '정관장'은 배구(레드스파크스)와 농구(레드부스터스)에 모두 있으므로 구단명까지 명시
const VOLLEYBALL_TEAM_HINTS = [
  '흥국생명', '현대건설', 'GS칼텍스', 'IBK기업은행', '페퍼저축은행', '레드스파크스',
  '대한항공', '우리카드', 'OK금융', '삼성화재', 'KB손해보험', '한국전력', '핑크스파이더스',
];
const BASKETBALL_TEAM_HINTS = [
  '레드부스터스', '스카이거너스', '썬더스', 'DB프로미', 'KT소닉붐', 'SK나이츠',
  'KCC이지스', '가스공사 페가수스', '삼성 썬더스', '현대모비스 피버스', '엘지 세이커스',
];

/**
 * 경기 정보로 종목 자동 감지.
 * 우선순위: 리그명 키워드 > U/O 라인 크기 > 팀명 힌트 > 핸디캡 라인 크기
 */
export function detectSport(opts: {
  leagueName?: string | null;
  sportName?: string | null;
  homeName?: string | null;
  awayName?: string | null;
  /** 언더오버 라인값 (숫자) */
  totalLine?: number | null;
  /** 핸디캡 라인값 (절대값 숫자) */
  handicapLine?: number | null;
  /** 마진 유형 임계값 (승1패=1 → 야구, 승5패=5 → 농구). 종목 판별에 가장 강한 신호 */
  marginThreshold?: number | null;
}): SportKey {
  const { leagueName, sportName, homeName, awayName, totalLine, handicapLine, marginThreshold } = opts;
  const text = `${sportName ?? ''} ${leagueName ?? ''}`;

  // 1) 리그/종목명 명시 (가장 신뢰도 높음)
  for (const [sport, keywords] of LEAGUE_KEYWORDS) {
    if (keywords.some(k => text.includes(k))) return sport;
  }

  // 2) 마진 유형 — 공식 규정상 승1패는 야구에만, 승5패는 농구에만 발매된다
  //    (출처: sportstoto.co.kr 승5패 안내 / 2023 야구승1패 발매 안내)
  if (marginThreshold === 1) return 'baseball';
  if (marginThreshold === 5) return 'basketball';

  // 3) 언더오버 라인 크기 — 종목별 범위로 1차 판정
  if (totalLine != null && totalLine > 0) {
    if (totalLine <= 4.5) return 'soccer';
    if (totalLine < 120) return 'baseball';
    // 120 이상: 농구(130~240)와 배구(150~210)가 겹침 → 핸디캡 단위로 구분
    //   농구 핸디캡은 점수(보통 3~20), 배구 핸디캡은 세트스코어(1.5 등 작은 값)
    if (totalLine > 215) return 'basketball';   // 배구 총득점이 215를 넘기는 매우 드묾
    // 팀명이 확실하면 핸디캡 크기보다 우선 (농구 핸디 2.5처럼 작은 값도 있음)
    const teamsInRange = `${homeName ?? ''} ${awayName ?? ''}`;
    if (BASKETBALL_TEAM_HINTS.some(v => teamsInRange.includes(v))) return 'basketball';
    if (VOLLEYBALL_TEAM_HINTS.some(v => teamsInRange.includes(v))) return 'volleyball';
    if (handicapLine != null && handicapLine > 0) {
      return handicapLine >= 3 ? 'basketball' : 'volleyball';
    }
    // 핸디캡 정보가 없으면 팀명으로 재확인
    const t = `${homeName ?? ''} ${awayName ?? ''}`;
    if (BASKETBALL_TEAM_HINTS.some(v => t.includes(v))) return 'basketball';
    if (VOLLEYBALL_TEAM_HINTS.some(v => t.includes(v))) return 'volleyball';
    // 한계: U/O만 150~215 구간이고 핸디캡·팀명 단서가 모두 없으면 구분 불가.
    // 국내 발매 빈도가 높은 농구를 기본값으로 둔다.
    return 'basketball';
  }

  // 3) 팀명 힌트
  const teams = `${homeName ?? ''} ${awayName ?? ''}`;
  if (BASEBALL_TEAM_HINTS.some(t => teams.includes(t))) return 'baseball';
  if (VOLLEYBALL_TEAM_HINTS.some(t => teams.includes(t))) return 'volleyball';

  // 4) 핸디캡 라인 크기 (보조 신호)
  if (handicapLine != null && handicapLine > 0) {
    if (handicapLine >= 5) return 'basketball';
    if (handicapLine >= 2) return 'baseball';
  }

  return 'soccer';
}

/** 숫자만 추출 (예: "U/O 5.5" → 5.5, "H+2.5" → 2.5) */
export function parseLineNumber(line?: string | null): number | null {
  if (!line) return null;
  const m = line.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 핸디캡 부호 포함 값 (예: "H+2.5" → +2.5, "H-1.5" → -1.5) */
export function parseHandicapValue(line?: string | null): number | null {
  if (!line) return null;
  const m = line.match(/([+-])\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[2]);
  if (!Number.isFinite(v)) return null;
  return m[1] === '-' ? -v : v;
}

/** 마진 유형(승1패/승5패) 라벨인지 판별 */
export function isMarginLabel(line?: string | null): boolean {
  if (!line) return false;
  return /승\s*\d+\s*패/.test(line);
}

/** 마진 임계값 추출 ("승1패" → 1, "승5패" → 5) */
export function parseMarginThreshold(line?: string | null): number | null {
  if (!line) return null;
  const m = line.match(/승\s*(\d+)\s*패/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 종목별 규정을 AI 프롬프트용 텍스트로 생성
 */
export function buildSportRulesPrompt(sport: SportKey, opts?: {
  totalLine?: number | null;
  handicapValue?: number | null;
  marginThreshold?: number | null;
}): string {
  const r = SPORT_RULES[sport];
  const lines: string[] = [
    `## 종목 규정 [${r.name}] — 스포츠토토 프로토 승부식 공식 규정`,
    `- 대상경기 적용 기준: ${r.timeBasis}`,
    `- 무승부 처리: ${r.drawHandling}`,
    `- 핸디캡 기준 단위: ${r.handicapUnit}`,
    `- 언더오버 기준: ${r.totalUnit}`,
  ];

  if (r.halfBasis) {
    lines.push(`- 전반 상품 기준: ${r.halfBasis}`);
  } else {
    lines.push(`- 전반 상품: ${r.name}는 전반 상품이 없음`);
  }

  if (!r.hasDraw) {
    lines.push(`- ⚠️ ${r.name}는 승무패에 '무' 항목이 없다 → draw_pct = 0, ht_draw_pct = 0 필수`);
  }

  if (r.margin && opts?.marginThreshold != null) {
    const t = opts.marginThreshold;
    lines.push(
      ``,
      `### ${r.margin.label} 유형 (margin) — 핸디캡과 완전히 다른 유형이다`,
      `- ${r.margin.desc}`,
      `- 승 = 홈팀이 ${t + 1}점차 이상 승리 → 이것은 "홈팀 승리"의 부분집합`,
      `- 중간(무 칸에 표시) = ${t}점차 이내 승부. 어느 팀이 이기든 상관없고 무승부도 포함`,
      `- 패 = 홈팀이 ${t + 1}점차 이상 패배 → 이것은 "원정팀 승리"의 부분집합`,
      `- 수학적 필수 관계: margin 승 확률 ≤ 승무패 홈승 확률, margin 패 확률 ≤ 승무패 원정승 확률`,
      `- 중간 확률이 가장 큰 경우가 흔하다 (${t}점차 이내는 범위가 넓기 때문)`,
    );
  }

  if (opts?.handicapValue != null) {
    const h = opts.handicapValue;
    const unit = r.handicapUnit;
    lines.push(
      ``,
      `### 핸디캡 H${h >= 0 ? '+' : ''}${h} 규정`,
      `- 홈팀 실제 ${unit}에 ${h >= 0 ? '+' : ''}${h}를 더한 뒤 원정팀과 비교한다`,
      `- 승 = (홈 ${unit} ${h >= 0 ? '+' : '-'} ${Math.abs(h)}) > 원정 ${unit}`,
      `- 패 = (홈 ${unit} ${h >= 0 ? '+' : '-'} ${Math.abs(h)}) < 원정 ${unit}`,
      Number.isInteger(h)
        ? `- 정수 핸디캡이므로 동점(무) 가능 → handicap_draw_pct > 0`
        : `- 소수점(.5) 핸디캡이므로 무 불가 → handicap_draw_pct = 0 필수`,
      h > 0
        ? `- 홈팀에게 유리한 핸디캡 → handicap_home_pct > home_win_pct 이고 handicap_away_pct < away_win_pct 가 반드시 성립`
        : `- 홈팀에게 불리한 핸디캡 → handicap_home_pct < home_win_pct 이고 handicap_away_pct > away_win_pct 가 반드시 성립`,
    );
  }

  if (opts?.totalLine != null) {
    lines.push(
      ``,
      `### 언더오버 U/O ${opts.totalLine} 규정`,
      `- ${r.totalUnit}이 ${opts.totalLine}보다 작으면 언더, 크면 오버`,
      `- 예상 스코어의 총합과 반드시 일치시킬 것: 총합 < ${opts.totalLine} → under_pct > over_pct`,
    );
  }

  return lines.join('\n');
}

// ── 팀명 국가 접두사 해석 ──────────────────────────────────────
// 젠토토는 이름이 겹치는 중동 클럽을 한 글자 국가 코드로 구분한다.
//   U알와흐다(UAE) / J알파이살리(요르단) / O알나흐다(오만)
// 반면 AC밀란·AS로마·FC댈러스처럼 2글자 이상 영문은 클럽명 일부이므로 건드리지 않는다.
const COUNTRY_PREFIX: Record<string, string | string[]> = {
  U: '아랍에미리트',
  J: '요르단',
  O: '오만',
  Q: '카타르',
  K: '쿠웨이트',
  B: '바레인',
  L: '레바논',
  P: '팔레스타인',
  Y: '예멘',
  // 첫 글자가 겹쳐 단정할 수 없는 경우 후보를 모두 넘긴다
  S: ['사우디아라비아', '시리아'],
  I: ['이라크', '이란'],
  T: ['타지키스탄', '투르크메니스탄'],
};

export interface TeamNameInfo {
  /** 접두사를 떼어낸 실제 팀명 */
  cleanName: string;
  /** 확정된 국가명 (후보가 여럿이거나 접두사가 없으면 null) */
  country: string | null;
  /** 후보가 여럿일 때의 목록 */
  candidates: string[] | null;
}

/**
 * 팀명에서 한 글자 국가 접두사를 해석한다.
 * 접두사가 없으면 원래 이름을 그대로 돌려준다.
 */
export function parseTeamName(name?: string | null): TeamNameInfo {
  const raw = (name ?? '').trim();
  // 한 글자 대문자 + 한글로 시작해야 접두사로 본다 (AC밀란 같은 2글자는 제외)
  const m = raw.match(/^([A-Z])([가-힣].*)$/);
  if (!m) return { cleanName: raw, country: null, candidates: null };

  const mapped = COUNTRY_PREFIX[m[1]];
  if (!mapped) return { cleanName: raw, country: null, candidates: null };

  return Array.isArray(mapped)
    ? { cleanName: m[2].trim(), country: null, candidates: mapped }
    : { cleanName: m[2].trim(), country: mapped, candidates: null };
}

/** 프롬프트에 넣을 한 줄 설명 생성 */
export function describeTeamOrigin(label: string, name?: string | null): string | null {
  const info = parseTeamName(name);
  if (info.country) {
    return `${label} "${info.cleanName}" — 국가: ${info.country} (팀명 접두사로 확인됨, 추측 아님)`;
  }
  if (info.candidates) {
    return `${label} "${info.cleanName}" — 국가 후보: ${info.candidates.join(' 또는 ')} (접두사로 좁혀짐. 클럽명으로 판단할 것)`;
  }
  return null;
}

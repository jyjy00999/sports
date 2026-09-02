// ══════════════════════════════════════════════
//  공통 타입 정의
// ══════════════════════════════════════════════

export type MatchStatus = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
export type MappingStatus = 'pending' | 'matched' | 'unmatched' | 'manual';
export type InjuryType = 'injured' | 'suspended' | 'doubtful' | 'illness';

// ── 리그 ──
export interface League {
  id: string;
  name_kr: string;
  name_en: string;
  country: string;
  logo_url?: string;
  api_football_id?: number;
  espn_slug?: string;
  sport: { name_kr: string; icon: string };
}

// ── 팀 ──
export interface Team {
  id: string;
  name_kr: string;
  name_en: string;
  short_name?: string;
  logo_url?: string;
  api_football_id?: number;
}

// ── 경기 ──
export interface Match {
  id: string;
  betman_round?: string;
  betman_game_no?: number;
  league: League;
  home_team: Team;
  away_team: Team;
  match_date: string;
  status: MatchStatus;
  mapping_status: MappingStatus;
  home_score?: number;
  away_score?: number;
  venue?: string;
  // 조인 데이터
  latest_odds?: OddsSnapshot;
  bet_combos?: BetCombo[];
  injuries?: MatchAbsence[];
  ai_analysis?: AIAnalysis;
}

// ── 베팅 조합 (배트맨 전 유형) ──
export interface BetCombo {
  bet_type:
    | 'match_winner' | 'handicap' | 'under_over' | 'sum'
    | 'ht_match_winner' | 'ht_handicap' | 'ht_under_over';  // 전반전
  betman_combo_no: number | null;
  bet_label: string;
  line_value?: string | null;
  // 승무패 / 핸디캡
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  // 언더오버
  under_odds?: number | null;
  over_odds?: number | null;
  // 홀짝(SUM)
  odd_odds?: number | null;
  even_odds?: number | null;
}

// ── 배당 ──
export interface OddsSnapshot {
  home_odds: number | null;
  draw_odds: number | null;
  away_odds: number | null;
  provider: string;
  recorded_at: string;
}

export interface OddsHistory {
  match_id: string;
  provider: string;
  home_odds: number;
  draw_odds?: number;
  away_odds: number;
  recorded_at: string;
}

// ── 결장/부상 ──
export interface MatchAbsence {
  id: string;
  player: {
    id: string;
    name_en: string;
    name_kr?: string;
    position?: string;
    photo_url?: string;
  };
  team_id: string;
  type: InjuryType;
  reason?: string;
  confirmed: boolean;
}

// ── 선수 스탯 ──
export interface PlayerStats {
  player_id: string;
  name_en: string;
  name_kr?: string;
  photo_url?: string;
  position?: string;
  goals: number;
  assists: number;
  appearances: number;
  rating?: number;
  minutes: number;
  shots_total?: number;
  yellow_cards: number;
  red_cards: number;
}

// ── AI 분석 ──
export interface AIAnalysis {
  winner: string;
  winner_team: 'home' | 'away' | 'draw';
  home_win_pct: number;
  draw_pct: number;
  away_win_pct: number;
  expected_score: string;
  home_analysis: string;
  away_analysis: string;
  key_points: string[];
  tactics: string;
  injury_impact: string;
  odds_analysis: string;
  verdict: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  // 전체 베팅 유형 확률
  handicap_home_pct?: number;
  handicap_draw_pct?: number;
  handicap_away_pct?: number;
  under_pct?: number;
  over_pct?: number;
  odd_pct?: number;
  even_pct?: number;
  // 전반전 베팅 확률
  ht_home_win_pct?: number;
  ht_draw_pct?: number;
  ht_away_win_pct?: number;
  ht_handicap_home_pct?: number;
  ht_handicap_draw_pct?: number;
  ht_handicap_away_pct?: number;
  ht_under_pct?: number;
  ht_over_pct?: number;
  // 최고 추천
  best_bet_type?: string;
  best_bet_option?: string;
  best_bet_reason?: string;

  // ─── 스포츠별 상세 분석 ───────────────────────
  sport_type?: 'soccer' | 'baseball';
  match_summary?: string;          // 5~7문장 종합 서술

  // 축구 전용
  home_attack_rating?: number;     // 공격력 1~10
  home_defense_rating?: number;    // 수비력 1~10
  away_attack_rating?: number;
  away_defense_rating?: number;
  home_recent_form?: string;       // "WWDLW" (최근 5경기)
  away_recent_form?: string;
  h2h_summary?: string;            // 상대전적 요약 텍스트
  key_absences_home?: string[];    // 주요 결장 선수
  key_absences_away?: string[];

  // 야구 전용
  home_pitcher_name?: string;
  away_pitcher_name?: string;
  home_pitcher_era?: number;
  away_pitcher_era?: number;
  home_pitcher_record?: string;    // "10승5패"
  away_pitcher_record?: string;
  home_batting_avg?: number;       // 팀 타율 (예: 0.265)
  away_batting_avg?: number;
  home_team_hr?: number;           // 시즌 홈런 수
  away_team_hr?: number;
  home_team_hits?: number;         // 시즌 안타 수
  away_team_hits?: number;
  home_team_strikeouts?: number;   // 시즌 삼진 수 (타자 기준)
  away_team_strikeouts?: number;
}

// ── API 응답 ──
export interface MatchesResponse {
  matches: Match[];
  total: number;
  round?: string;
}

export interface AnalysisResponse {
  result: AIAnalysis;
  cached: boolean;
}

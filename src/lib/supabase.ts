import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;

// 서버 전용 (service role) — 클라이언트에 노출 금지
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// ── 경기 목록 조회 (회차 기준) ──
export async function getMatchesByRound(round?: string) {
  let query = supabase
    .from('matches')
    .select(`
      *,
      league:leagues(id, name_kr, name_en, logo_url),
      home_team:teams!home_team_id(id, name_kr, name_en, short_name, logo_url),
      away_team:teams!away_team_id(id, name_kr, name_en, short_name, logo_url),
      odds_history(home_odds, draw_odds, away_odds, under_odds, over_odds, odd_odds, even_odds, provider, recorded_at, bet_type, betman_combo_no, bet_label, line_value)
    `)
    .order('betman_game_no', { ascending: true });

  if (round) query = query.eq('betman_round', round);
  else query = query.gte('match_date', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

  const { data, error } = await query.limit(50);
  if (error) throw new Error(error.message);

  // 전체 베팅 조합 추출 (조합 번호 순 정렬)
  return (data ?? []).map(m => {
    type OddsRow = {
      home_odds: number | null; draw_odds: number | null; away_odds: number | null;
      under_odds?: number | null; over_odds?: number | null;
      odd_odds?: number | null; even_odds?: number | null;
      provider: string; recorded_at: string;
      bet_type?: string; betman_combo_no?: number | null;
      bet_label?: string; line_value?: string | null;
    };
    const arr = ((m as Record<string, unknown>).odds_history as OddsRow[] | null) ?? [];
    // 조합 번호 순 정렬
    const sorted = [...arr].sort((a, b) => (a.betman_combo_no ?? 0) - (b.betman_combo_no ?? 0));
    // 승무패 기준 최신 배당 (헤더용)
    const best = sorted.find(o => !o.bet_type || o.bet_type === 'match_winner') ?? sorted[0] ?? null;
    const result = { ...m } as Record<string, unknown>;
    delete result.odds_history;
    return {
      ...result,
      latest_odds: best ? {
        home_odds: best.home_odds,
        draw_odds: best.draw_odds,
        away_odds: best.away_odds,
        provider:  best.provider,
        recorded_at: best.recorded_at,
      } : undefined,
      bet_combos: sorted.map(o => ({
        bet_type:        (o.bet_type ?? 'match_winner') as 'match_winner' | 'handicap' | 'under_over' | 'sum',
        betman_combo_no: o.betman_combo_no ?? null,
        bet_label:       o.bet_label ?? '축구 승무패',
        line_value:      o.line_value ?? null,
        home_odds:       o.home_odds,
        draw_odds:       o.draw_odds,
        away_odds:       o.away_odds,
        under_odds:      o.under_odds ?? null,
        over_odds:       o.over_odds  ?? null,
        odd_odds:        o.odd_odds   ?? null,
        even_odds:       o.even_odds  ?? null,
      })),
    };
  });
}

// ── 최신 배당 조회 ──
export async function getLatestOdds(matchId: string) {
  const providers = ['betman', 'bet365', 'pinnacle'];
  const results: Record<string, unknown>[] = [];

  for (const provider of providers) {
    const { data } = await supabase
      .from('odds_history')
      .select('*')
      .eq('match_id', matchId)
      .eq('provider', provider)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();
    if (data) results.push(data);
  }
  return results;
}

// ── 배당 이력 조회 (차트용) ──
export async function getOddsHistory(matchId: string, provider = 'bet365') {
  const { data, error } = await supabase
    .from('odds_history')
    .select('home_odds, draw_odds, away_odds, recorded_at')
    .eq('match_id', matchId)
    .eq('provider', provider)
    .order('recorded_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── 결장자 조회 ──
export async function getMatchAbsences(matchId: string) {
  const { data, error } = await supabase
    .from('match_absences')
    .select(`
      *,
      player:players(id, name_en, name_kr, position, photo_url)
    `)
    .eq('match_id', matchId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── AI 분석 캐시 조회 / 저장 ──
export async function getCachedAnalysis(matchId: string) {
  const { data } = await supabase
    .from('ai_analyses')
    .select('result, created_at, expires_at')
    .eq('match_id', matchId)
    .gte('expires_at', new Date().toISOString())
    .single();
  return data;
}

export async function saveAnalysis(matchId: string, result: unknown) {
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('ai_analyses')
    .upsert({ match_id: matchId, result, expires_at: expiresAt });
}

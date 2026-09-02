import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

async function findOrCreateLeague(name_kr: string) {
  const { data } = await supabase.from('leagues').select('id').eq('name_kr', name_kr).limit(1);
  if (data?.length) return data[0].id;
  const sport = await supabase.from('sports').select('id').eq('name_en', 'soccer').limit(1);
  const sport_id = sport.data?.[0]?.id ?? null;
  const { data: ins } = await supabase.from('leagues').insert({ name_kr, name_en: name_kr, sport_id }).select('id');
  return ins?.[0]?.id ?? null;
}

async function findOrCreateTeam(name_kr: string, league_id: string | null) {
  // alias 검색
  const { data: alias } = await supabase.from('team_aliases').select('team_id').eq('alias', name_kr).limit(1);
  if (alias?.length) return alias[0].team_id;
  // teams 직접 검색
  const { data: team } = await supabase.from('teams').select('id').eq('name_kr', name_kr).limit(1);
  if (team?.length) {
    await supabase.from('team_aliases').upsert({ team_id: team[0].id, alias: name_kr, source: 'manual' });
    return team[0].id;
  }
  // 신규 생성
  const { data: newTeam } = await supabase.from('teams').insert({ name_kr, name_en: name_kr, league_id }).select('id');
  if (newTeam?.[0]?.id) {
    await supabase.from('team_aliases').insert({ team_id: newTeam[0].id, alias: name_kr, source: 'manual' });
    return newTeam[0].id;
  }
  return null;
}

type BetTypeRow = {
  combo_no?: number | null;
  type: string;
  label?: string;
  line_value?: string | null;
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  under_odds?: number | null;
  over_odds?: number | null;
  odd_odds?: number | null;
  even_odds?: number | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      betman_round, betman_game_no,
      league_name, home_name, away_name,
      match_date, venue,
      home_odds, draw_odds, away_odds,
      bet_types,  // 전체 베팅 유형 배열 (OCR에서 올 때)
    } = body;

    if (!home_name || !away_name || !match_date) {
      return NextResponse.json({ error: '홈팀, 원정팀, 경기일시는 필수입니다.' }, { status: 400 });
    }

    const league_id  = await findOrCreateLeague(league_name || '기타');
    const home_id    = await findOrCreateTeam(home_name, league_id);
    const away_id    = await findOrCreateTeam(away_name, league_id);

    if (!home_id || !away_id) {
      return NextResponse.json({ error: '팀 생성 실패' }, { status: 500 });
    }

    const betman_id = betman_round && betman_game_no
      ? `${betman_round}-${betman_game_no}`
      : `manual-${Date.now()}`;

    const { data: match, error } = await supabase.from('matches').upsert({
      betman_id,
      betman_round:   betman_round || null,
      betman_game_no: betman_game_no ? Number(betman_game_no) : null,
      league_id,
      home_team_id:   home_id,
      away_team_id:   away_id,
      match_date,
      venue:          venue || null,
      status:         'scheduled',
      mapping_status: 'manual',
    }, { onConflict: 'betman_id' }).select('id');

    if (error) throw error;

    const match_id = match?.[0]?.id;
    if (!match_id) return NextResponse.json({ error: '경기 저장 실패' }, { status: 500 });

    // ── 배당 저장 ──
    if (bet_types && Array.isArray(bet_types) && bet_types.length > 0) {
      // OCR에서 전달된 전체 베팅 유형 저장
      const rows = (bet_types as BetTypeRow[]).map(bt => ({
        match_id,
        provider:        'betman',
        bet_type:        bt.type ?? 'match_winner',
        betman_combo_no: bt.combo_no ? Number(bt.combo_no) : null,
        bet_label:       bt.label ?? '축구 승무패',
        line_value:      bt.line_value ?? null,
        home_odds:       bt.home_odds  != null ? Number(bt.home_odds)  : null,
        draw_odds:       bt.draw_odds  != null ? Number(bt.draw_odds)  : null,
        away_odds:       bt.away_odds  != null ? Number(bt.away_odds)  : null,
        under_odds:      bt.under_odds != null ? Number(bt.under_odds) : null,
        over_odds:       bt.over_odds  != null ? Number(bt.over_odds)  : null,
        odd_odds:        bt.odd_odds   != null ? Number(bt.odd_odds)   : null,
        even_odds:       bt.even_odds  != null ? Number(bt.even_odds)  : null,
      }));
      await supabase.from('odds_history').insert(rows);
    } else if (home_odds || draw_odds || away_odds) {
      // 수동 입력 폼 — 승무패만 저장
      await supabase.from('odds_history').insert({
        match_id,
        provider:  'betman',
        bet_type:  'match_winner',
        bet_label: '축구 승무패',
        home_odds:  home_odds  ? Number(home_odds)  : null,
        draw_odds:  draw_odds  ? Number(draw_odds)  : null,
        away_odds:  away_odds  ? Number(away_odds)  : null,
      });
    }

    return NextResponse.json({ success: true, match_id });
  } catch (err) {
    console.error('Manual match error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

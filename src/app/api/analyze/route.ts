/**
 * POST /api/analyze
 * 경기 AI 분석 (모든 베팅 유형 확률 포함)
 * - 1순위: Claude (Anthropic) — 최고 품질
 * - 2순위: Groq — 하루 200,000 토큰 무료
 * - 3순위: Google Gemini — 하루 1,500 요청 무료
 * - DB에 12시간 캐시 저장
 */
export const maxDuration = 120;
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getCachedAnalysis, saveAnalysis, getMatchAbsences } from '@/lib/supabase';
import type { Match, AIAnalysis, BetCombo } from '@/types';

// 1순위: Claude (Anthropic) — 최고 품질, maxRetries:0으로 429 즉시 반환
const claudeClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  maxRetries: 0,
});

// 2순위: Groq — 무료 티어
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? '',
  baseURL: 'https://api.groq.com/openai/v1',
});

// 3순위: Google Gemini — 무료 티어
const geminiClient = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY ?? '',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// 폴백 가능한 에러 코드 (한도/크레딧/모델 없음)
// OpenAI 클라이언트가 status를 숫자/문자열 두 형태로 내보낼 수 있어 Number()로 정규화
function isFallbackError(e: unknown): boolean {
  const rawStatus = (e as { status?: number | string })?.status;
  const status = Number(rawStatus);          // "404" → 404, undefined → NaN
  const msg = String((e as { message?: string })?.message ?? '');
  const errStr = String(e);                  // toString() 전체 (JSON 포함)
  return (
    status === 429 || status === 400 || status === 404 ||
    msg.includes('RESOURCE_EXHAUSTED') || msg.includes('spending cap') ||
    msg.includes('does not exist') || msg.includes('model_not_found') ||
    errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('spending cap') ||
    errStr.includes('does not exist') || errStr.includes('model_not_found')
  );
}

async function callAI(prompt: string): Promise<string> {
  const errors: string[] = [];

  // 1순위: Claude (Anthropic)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const msg = await Promise.race([
        claudeClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI_TIMEOUT')), 55000)),
      ]);
      return msg.content[0].type === 'text' ? msg.content[0].text : '';
    } catch (e) {
      if (isFallbackError(e)) {
        const status = (e as { status?: number })?.status ?? 'unknown';
      const msg = `Claude 실패 (${status}${status === 400 ? ' — 모델 오류 또는 크레딧 부족' : ''})`;

        console.warn('[Analyze]', msg, '→ Groq 폴백');
        errors.push(msg);
      } else {
        throw e;
      }
    }
  }

  // 2순위: Groq — 가용 모델 동적 조회 후 순차 시도
  if (process.env.GROQ_API_KEY) {
    // Groq 가용 모델 목록 조회
    let groqModels: string[] = [];
    try {
      const mRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        cache: 'no-store',
      });
      if (mRes.ok) {
        const mData = await mRes.json();
        groqModels = ((mData.data ?? []) as Array<{ id: string; created: number }>)
          .filter(m => {
            const id = m.id.toLowerCase();
            // 챗 가능한 모델만: llama/mixtral/gemma/qwen 포함, guard/whisper/embed 제외
            const isChatModel = id.includes('llama') || id.includes('mixtral') || id.includes('gemma') || id.includes('qwen');
            const isNonChat = id.includes('guard') || id.includes('whisper') || id.includes('embed') || id.includes('vision');
            return isChatModel && !isNonChat;
          })
          .sort((a, b) => b.created - a.created)  // 최신 모델 우선
          .map(m => m.id);
        console.log('[Analyze] Groq 가용 모델:', groqModels.slice(0, 5).join(', '));
      }
    } catch { /* 조회 실패 시 하드코딩 목록 사용 */ }

    // 조회 실패 시 알려진 모델 후보 사용
    if (groqModels.length === 0) {
      groqModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
        'llama-3.1-8b-instant',
        'llama3-8b-8192',
        'mixtral-8x7b-32768',
      ];
    }

    let groqSuccess = false;
    for (const model of groqModels.slice(0, 6)) { // 최대 6개 시도
      try {
        const res = await Promise.race([
          groqClient.chat.completions.create({
            model,
            max_tokens: 3000,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI_TIMEOUT')), 30000)),
        ]);
        console.log(`[Analyze] Groq ${model} 성공`);
        groqSuccess = true;
        return res.choices[0].message.content ?? '';
      } catch (e) {
        if (isFallbackError(e)) {
          console.warn(`[Analyze] Groq ${model} 실패 (${(e as { status?: number })?.status}) → 다음`);
          continue;
        }
        throw e;
      }
    }
    if (!groqSuccess) {
      const msg = 'Groq 모든 모델 실패';
      console.warn('[Analyze]', msg, '→ Gemini 폴백');
      errors.push(msg);
    }
  }

  // 3순위: Gemini — 여러 모델명 순차 시도
  if (process.env.GEMINI_API_KEY) {
    const geminiModels = [
      'gemini-2.5-flash',           // 현재 유효 모델
      'gemini-2.5-flash-8b',        // 경량 버전
      'gemini-2.5-flash-lite-preview-06-17', // lite 프리뷰
      'gemini-2.0-flash-lite',      // 2.0 경량
      'gemini-2.0-flash',           // 2.0
    ];
    for (const model of geminiModels) {
      try {
        const res = await Promise.race([
          geminiClient.chat.completions.create({
            model,
            max_tokens: 3000,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI_TIMEOUT')), 30000)),
        ]);
        console.log(`[Analyze] Gemini ${model} 성공`);
        return res.choices[0].message.content ?? '';
      } catch (e) {
        if (isFallbackError(e)) {
          console.warn(`[Analyze] Gemini ${model} 실패 (${(e as { status?: number })?.status}) → 다음`);
          continue;
        }
        throw e;
      }
    }
    // 모든 Gemini 모델도 실패
    const msg = 'Gemini 모든 모델 실패';
    errors.push(msg);
    console.error('[Analyze] 모든 AI 실패:', errors);
    throw new Error(`모든 AI 서비스 한도 초과 또는 오류. 잠시 후 다시 시도하세요.\n상세: ${errors.join(' / ')}`);
  }

  throw new Error(`사용 가능한 AI 서비스 없음 (이전 오류: ${errors.join(', ') || '키 없음'})`);
}

export async function POST(req: Request) {
  try {
    const { match, force = false }: { match: Match; force?: boolean } = await req.json();

    // 캐시 확인 (force=true면 건너뜀)
    if (!force) {
      const cached = await getCachedAnalysis(match.id);
      if (cached) {
        return NextResponse.json({ result: cached.result, cached: true });
      }
    }

    // 결장자 수집 (DB)
    const absences = await getMatchAbsences(match.id);
    const homeAbsences = absences.filter(a => a.team_id === (match.home_team as { id?: string } | null)?.id);
    const awayAbsences = absences.filter(a => a.team_id === (match.away_team as { id?: string } | null)?.id);

    // 결장자만 수집 (투수 데이터는 클라이언트에서 별도 수집 — 분석 속도에 영향 없음)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const withTimeout = (p: Promise<unknown>, ms: number) =>
      Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
    const [injuriesData] = await Promise.allSettled([
      withTimeout(fetch(`${baseUrl}/api/external/injuries?match_id=${match.id}`).then(r => r.ok ? r.json() : null), 5000),
    ]);
    const pitchers = null; // 투수 데이터는 프롬프트에서 제외 (클라이언트 패널에서 직접 표시)
    const injuries = (injuriesData.status === 'fulfilled' ? injuriesData.value : null) as Record<string,unknown> | null;

    const betCombos = (match as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
    const prompt = buildAnalysisPrompt({ match, homeAbsences, awayAbsences, betCombos, pitchers, injuries });

    const raw = await callAI(prompt);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답 파싱 실패');

    const result: AIAnalysis = JSON.parse(jsonMatch[0]);

    // ── 일관성 후처리: 예상스코어 ↔ 언더오버 모순 수정 ──────────────
    if (result.expected_score && result.under_pct != null && result.over_pct != null) {
      // "1-0", "2-1" 등에서 총 골 수 추출
      const scoreMatch = result.expected_score.match(/(\d+)[:\-](\d+)/);
      if (scoreMatch) {
        const totalGoals = parseInt(scoreMatch[1]) + parseInt(scoreMatch[2]);
        const line = 2.5; // 기본 언더오버 기준선
        if (totalGoals <= line && result.over_pct > result.under_pct) {
          // 예상스코어는 언더인데 오버가 높음 → 언더오버 교정
          [result.under_pct, result.over_pct] = [result.over_pct, result.under_pct];
          console.log(`[Analyze] 일관성 교정: 예상${result.expected_score}(${totalGoals}골≤${line}) → 언더${result.under_pct}%/오버${result.over_pct}%`);
        } else if (totalGoals > line && result.under_pct > result.over_pct) {
          // 예상스코어는 오버인데 언더가 높음 → 교정
          [result.under_pct, result.over_pct] = [result.over_pct, result.under_pct];
          console.log(`[Analyze] 일관성 교정: 예상${result.expected_score}(${totalGoals}골>${line}) → 언더${result.under_pct}%/오버${result.over_pct}%`);
        }
      }
    }

    await saveAnalysis(match.id, result);

    return NextResponse.json({ result, cached: false });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    console.error('Analyze API error:', msg);
    // 한도 초과 vs 기타 에러 구분
    const isQuota = msg.includes('한도') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('spending cap');
    return NextResponse.json({
      error: isQuota
        ? 'AI 서비스 한도 초과 — 잠시 후 재시도하거나 API 크레딧을 충전하세요'
        : '분석 실패',
      detail: msg,
    }, { status: 500 });
  }
}

function buildAnalysisPrompt({ match, homeAbsences, awayAbsences, betCombos, pitchers, injuries }: {
  match: Match;
  homeAbsences: Array<Record<string, unknown>>;
  awayAbsences: Array<Record<string, unknown>>;
  betCombos: BetCombo[];
  pitchers: Record<string, unknown> | null;
  injuries: Record<string, unknown> | null;
}): string {
  const homeAbsList = homeAbsences.map((a: Record<string, unknown>) => {
    const p = a.player as Record<string, unknown> | undefined;
    return `  - ${p?.name_en ?? '알 수 없음'} (${a.type}: ${a.reason ?? '-'})`;
  }).join('\n') || '  없음';

  const awayAbsList = awayAbsences.map((a: Record<string, unknown>) => {
    const p = a.player as Record<string, unknown> | undefined;
    return `  - ${p?.name_en ?? '알 수 없음'} (${a.type}: ${a.reason ?? '-'})`;
  }).join('\n') || '  없음';

  const mw    = betCombos.find(c => c.bet_type === 'match_winner');
  const hc    = betCombos.find(c => c.bet_type === 'handicap');
  const uo    = betCombos.find(c => c.bet_type === 'under_over');
  const sm    = betCombos.find(c => c.bet_type === 'sum');
  const htMw  = betCombos.find(c => c.bet_type === 'ht_match_winner');
  const htHc  = betCombos.find(c => c.bet_type === 'ht_handicap');
  const htUo  = betCombos.find(c => c.bet_type === 'ht_under_over');

  const lo = match.latest_odds;
  const mwOdds = mw ?? (lo ? { home_odds: lo.home_odds, draw_odds: lo.draw_odds, away_odds: lo.away_odds } : null);

  // 핸디캡이 여러 개인 경우 모두 표시
  const allHc = betCombos.filter(c => c.bet_type === 'handicap');

  const oddsSection = [
    mwOdds ? `[승무패]           홈 ${mwOdds.home_odds} / 무 ${mwOdds.draw_odds ?? '-'} / 원정 ${mwOdds.away_odds}` : '',
    ...allHc.map(h => `[핸디캡 ${h.line_value ?? '승1패'}]    홈 ${h.home_odds} / 무 ${h.draw_odds ?? '-'} / 원정 ${h.away_odds}`),
    uo     ? `[언더오버 ${uo.line_value ?? ''}]   언더 ${uo.under_odds} / 오버 ${uo.over_odds}` : '',
    sm     ? `[홀짝 SUM]         홀 ${sm.odd_odds} / 짝 ${sm.even_odds}` : '',
    htMw   ? `[전반전 승무패]     홈 ${htMw.home_odds} / 무 ${htMw.draw_odds ?? '-'} / 원정 ${htMw.away_odds}` : '',
    htHc   ? `[전반전 핸디캡 ${htHc.line_value ?? ''}] 홈 ${htHc.home_odds} / 무 ${htHc.draw_odds ?? '-'} / 원정 ${htHc.away_odds}` : '',
    htUo   ? `[전반전 언더오버 ${htUo.line_value ?? ''}] 언더 ${htUo.under_odds} / 오버 ${htUo.over_odds}` : '',
  ].filter(Boolean).join('\n') || '배당 데이터 없음';

  const leagueName  = (match.league  as { name_kr?: string } | null)?.name_kr  ?? '기타';
  const homeName    = (match.home_team as { name_kr?: string } | null)?.name_kr ?? match.home_team?.name_en ?? '홈팀';
  const awayName    = (match.away_team as { name_kr?: string } | null)?.name_kr ?? match.away_team?.name_en ?? '원정팀';

  // ── 선발 투수 섹션 빌드 ───────────────────────────────────────
  let pitcherSection = '';
  if (pitchers && (pitchers.home || pitchers.away)) {
    const fmt = (p: Record<string,unknown> | null, side: string) => {
      if (!p) return `${side}: 미확인`;
      const name = p.name as string;
      const parts = [name];
      if (p.era != null) parts.push(`ERA ${p.era}`);
      if (p.wins != null && p.losses != null) parts.push(`${p.wins}승 ${p.losses}패`);
      if (p.whip != null) parts.push(`WHIP ${p.whip}`);
      if (p.k9 != null) parts.push(`K/9 ${p.k9}`);
      const src = p.source ? ` [${p.source} 공식]` : '';
      return `${side}: ${parts.join(', ')}${src}`;
    };
    pitcherSection = `\n## 선발 투수\n${fmt(pitchers.home as Record<string,unknown>|null, `홈 (${homeName})`)}\n${fmt(pitchers.away as Record<string,unknown>|null, `원정 (${awayName})`)}`;
  }

  // ── 공식 부상/결장자 섹션 빌드 ──────────────────────────────
  let extInjurySection = '';
  if (injuries && (injuries.home || injuries.away)) {
    const fmt = (t: Record<string,unknown> | null) => {
      if (!t) return '  정보 없음';
      const players = (t.players as Array<{ name: string; injury: string; status: string; chanceOfPlaying: number | null }>) ?? [];
      if (players.length === 0) return '  부상/결장자 없음';
      return players.map(p => {
        const chance = p.chanceOfPlaying != null ? ` (출전 가능성 ${p.chanceOfPlaying}%)` : '';
        return `  - ${p.name}: ${p.injury} [${p.status}]${chance}`;
      }).join('\n');
    };
    const src = (injuries.source as string) ?? '';
    extInjurySection = `\n## 공식 부상/결장자 [출처: ${src}]\n홈팀 (${homeName}):\n${fmt(injuries.home as Record<string,unknown>|null)}\n원정팀 (${awayName}):\n${fmt(injuries.away as Record<string,unknown>|null)}`;
  }

  // 스포츠 타입 감지
  const isBaseballLeague = ['MLB','KBO','NPB','야구','메이저리그','퍼시픽','센트럴'].some(k => leagueName.includes(k));
  const sportType = isBaseballLeague ? 'baseball' : 'soccer';

  // 스포츠별 추가 필드 안내
  const sportSpecificFields = isBaseballLeague ? `
  "sport_type": "baseball",
  "match_summary": "5~7문장 경기 종합 서술 (선발 투수 비교 / 팀 타선 / 상대전적 / 최근 흐름 포함)",
  "h2h_summary": "최근 시즌 상대전적 요약 (승-무-패 형식 포함)",
  "home_pitcher_name": "홈팀 선발투수 이름 (영문, 데이터 없으면 null)",
  "away_pitcher_name": "원정팀 선발투수 이름 (영문, 데이터 없으면 null)",
  "home_pitcher_era": 홈_선발_ERA_소수점1자리_또는_null,
  "away_pitcher_era": 원정_선발_ERA_소수점1자리_또는_null,
  "home_pitcher_record": "홈팀 투수 시즌 성적 예: 10승5패 (없으면 null)",
  "away_pitcher_record": "원정팀 투수 시즌 성적 (없으면 null)",
  "home_batting_avg": 홈팀_팀타율_소수점3자리_예시_0.265_또는_null,
  "away_batting_avg": 원정팀_팀타율_또는_null,
  "home_team_hr": 홈팀_시즌_홈런수_정수_또는_null,
  "away_team_hr": 원정팀_시즌_홈런수_정수_또는_null,
  "home_team_hits": 홈팀_시즌_안타수_정수_또는_null,
  "away_team_hits": 원정팀_시즌_안타수_정수_또는_null,
  "home_team_strikeouts": 홈팀_시즌_삼진수_타자기준_정수_또는_null,
  "away_team_strikeouts": 원정팀_시즌_삼진수_타자기준_정수_또는_null,` : `
  "sport_type": "soccer",
  "match_summary": "5~7문장 경기 종합 서술 (공/수 분석 / 결장자 영향 / 상대전적 / 최근 폼 포함)",
  "home_attack_rating": 홈팀_공격력_1~10_정수,
  "home_defense_rating": 홈팀_수비력_1~10_정수,
  "away_attack_rating": 원정팀_공격력_1~10_정수,
  "away_defense_rating": 원정팀_수비력_1~10_정수,
  "home_recent_form": "최근5경기_W승D무L패_예시_WWDLW",
  "away_recent_form": "최근5경기_예시_LWWDW",
  "h2h_summary": "최근 5경기 상대전적 요약 (예: 3승1무1패, 최근 홈팀 2연승)",
  "key_absences_home": ["핵심결장선수1_이름", "핵심결장선수2_이름"],
  "key_absences_away": ["핵심결장선수1_이름"],`;

  return `당신은 전문 스포츠 애널리스트입니다. 아래 데이터를 바탕으로 경기를 분석해주세요.

## 경기 정보
리그: ${leagueName}
경기: ${homeName} vs ${awayName}
일정: ${new Date(match.match_date).toLocaleString('ko-KR')}
${match.venue ? `장소: ${match.venue}` : ''}
${match.betman_round ? `배트맨 회차: ${match.betman_round} (${match.betman_game_no}번 경기)` : ''}

## 배당률
${oddsSection}
${pitcherSection}
${extInjurySection}

## 홈팀 결장자-DB (${homeName})
${homeAbsList}

## 원정팀 결장자-DB (${awayName})
${awayAbsList}

---

⚠️ 중요 일관성 규칙:
- expected_score의 총 골 수가 2.5 이하이면 under_pct > over_pct 여야 함 (예: 1-0, 1-1, 2-0)
- expected_score의 총 골 수가 2.5 초과이면 over_pct > under_pct 여야 함 (예: 2-1, 3-0)
- winner_team이 "home"이면 home_win_pct가 가장 높아야 함
- home_win_pct + draw_pct + away_win_pct = 100 이어야 함

아래 JSON 형식으로만 응답해 (마크다운 없이, 순수 JSON만):
{
  "winner": "예상 승리팀 이름 또는 '무승부'",
  "winner_team": "home 또는 away 또는 draw",
  "home_win_pct": 홈팀_승리확률_정수,
  "draw_pct": 무승부_확률_정수,
  "away_win_pct": 원정팀_승리확률_정수,
  "expected_score": "예상 스코어 예: 2-1 또는 3-2",
  "home_analysis": "홈팀 전력 분석 (3문장)",
  "away_analysis": "원정팀 전력 분석 (3문장)",
  "key_points": ["핵심 분석 1", "핵심 분석 2", "핵심 분석 3", "핵심 분석 4"],
  "tactics": "예상 전술 및 경기 운영 패턴",
  "injury_impact": "결장자가 경기에 미치는 영향",
  "odds_analysis": "배당 분석 인사이트",
  "verdict": "최종 픽 및 종합 의견 (4문장)",
  "confidence": "HIGH 또는 MEDIUM 또는 LOW",
  "handicap_home_pct": 핸디캡_홈승_확률_정수,
  "handicap_draw_pct": 핸디캡_무_확률_정수,
  "handicap_away_pct": 핸디캡_원정승_확률_정수,
  "under_pct": 언더_확률_정수,
  "over_pct": 오버_확률_정수,
  "odd_pct": 홀_확률_정수,
  "even_pct": 짝_확률_정수,
  "ht_home_win_pct": 전반전_홈승_확률_정수,
  "ht_draw_pct": 전반전_무승부_확률_정수,
  "ht_away_win_pct": 전반전_원정승_확률_정수,
  "ht_handicap_home_pct": 전반전_핸디캡_홈승_확률_정수,
  "ht_handicap_draw_pct": 전반전_핸디캡_무_확률_정수,
  "ht_handicap_away_pct": 전반전_핸디캡_원정승_확률_정수,
  "ht_under_pct": 전반전_언더_확률_정수,
  "ht_over_pct": 전반전_오버_확률_정수,
  "best_bet_type": "match_winner 또는 handicap 또는 under_over 또는 sum 또는 ht_match_winner 또는 ht_handicap 또는 ht_under_over",
  "best_bet_option": "가장 추천하는 옵션 (예: 홈승, 언더, 홀 등)",
  "best_bet_reason": "해당 베팅을 추천하는 핵심 이유 (1문장, 간결하게)",
${sportSpecificFields}
}

규칙:
- home_win_pct + draw_pct + away_win_pct = 100
- handicap_home_pct + handicap_draw_pct + handicap_away_pct = 100
- under_pct + over_pct = 100
- odd_pct + even_pct = 100
- ht_home_win_pct + ht_draw_pct + ht_away_win_pct = 100
- ht_handicap_home_pct + ht_handicap_draw_pct + ht_handicap_away_pct = 100
- ht_under_pct + ht_over_pct = 100
- 전반전 배당이 없으면 전체 경기 결과를 바탕으로 전반전 확률 추정
- 한국어로 작성
- JSON 외에 다른 텍스트 절대 포함 금지

[핸디캡 일관성 필수 규칙]
- H+ (홈팀 유리 핸디): handicap_home_pct >= home_win_pct
- H- (홈팀 불리 핸디): handicap_home_pct <= home_win_pct
- 승무패에서 홈이 이긴다고 했으면, 홈 유리 핸디에서 원정이 이긴다고 하면 절대 안 됨
- 핸디캡 라인이 클수록 불리한 팀의 핸디 승률은 반드시 낮아야 함 (H-1과 H-2.5의 확률이 같으면 안 됨)
- 승1패 핸디캡 (H-1): 2점 이상 차이로 이겨야 승, 1점 이내 차이(홈 1점 승 / 동점 0:0 / 원정 1점 승)는 양팀 모두 무, 원정이 2점 이상 차로 이겨야 패
  → 즉 "동점도 무", "원정 1점 승도 무" — 무 확률이 일반 승무패보다 훨씬 넓은 범위
- H-2.5, H-1.5 등 .5 라인: 소수점 반 점이므로 무(push) 절대 불가, 반드시 handicap_draw_pct = 0 및 ht_handicap_draw_pct = 0
  (예: "5회 핸디캡 H-1.5"는 절대 무가 나올 수 없음 → ht_handicap_draw_pct = 0 필수)
- 승1패 무 확률은 반드시 match_winner의 draw_pct보다 훨씬 높아야 함 (±1점 범위이므로)
- 야구 기준 핸디 1점 차이마다 홈 승률 약 8~12%p 차이 발생

[승1패 무 확률 역산 필수 — 위반 시 오류]
- 배당 표에 무 배당(예: 2.90)이 있으면 handicap_draw_pct는 절대 0이 되면 안 됨
- 무 확률 계산법: (1/무배당) / ((1/홈배당)+(1/무배당)+(1/원정배당)) × 100 (정규화)
  예) 홈3.10 / 무2.90 / 원정2.07 → 역수합=0.323+0.345+0.483=1.151 → 무=0.345/1.151=30%
  → handicap_draw_pct = 30 (반드시 이 정도 수준으로 설정)
- 예상 스코어 차이가 ±1점(예: 3-4, 2-1, 1-0 등 1점 차)이면
  → 해당 결과 자체가 승1패에서 무 → handicap_draw_pct를 가장 높은 값으로 설정(최소 35 이상)
- 예상 스코어가 2점 이상 차이 → 승 또는 패가 가장 높은 값
- handicap_home_pct + handicap_draw_pct + handicap_away_pct = 반드시 100

[야구 투수 분석 규칙]
- 야구는 선발 투수가 승패를 좌우하는 가장 중요한 변수임
- 투수 정보(방어율, 피안타율, 이번 시즌 성적)가 없으면: 배당률을 가장 중요한 신호로 삼아 역산하여 확률 설정
- 배당 1.8 : 2.0 = 약 53% : 47% (배당 역수 기준), 이를 기반으로 전력 차이 반영
- 투수 정보 없이 홈팀 57% 같은 높은 수치를 단정하지 말 것 — 불확실성 반영해서 55:45 수준 유지
- key_points 중 하나는 반드시 "선발 투수 정보 미확인 — 배당 기반으로 추정" 등으로 명시할 것`;
}

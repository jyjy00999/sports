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
import { detectSport, parseLineNumber, parseHandicapValue, buildSportRulesPrompt, parseMarginThreshold, describeTeamOrigin, SPORT_RULES, type SportKey } from '@/lib/sports-rules';
import { deriveMarkets, deriveFromMarginTotal, usesMarginTotalModel, rankOptions, type ScoreProb, type MarginProb, type TotalProb } from '@/lib/score-model';
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

    // 외부 데이터 병렬 수집 (결장자 + Sofascore)
    // 내부 API 호출은 반드시 '자기 자신'을 향해야 한다.
    // NEXT_PUBLIC_APP_URL(운영 주소)을 쓰면 로컬 개발 서버가 운영 서버를 호출해
    // 구버전 코드의 응답을 받는 문제가 생긴다.
    const baseUrl = new URL(req.url).origin;
    const withTimeout = (p: Promise<unknown>, ms: number) =>
      Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);

    const betCombosForSport = (match as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
    const uoForSport = betCombosForSport.find(c => c.bet_type === 'under_over');
    const hcForSport = betCombosForSport.find(c => c.bet_type === 'handicap');
    const mgForSport = betCombosForSport.find(c => c.bet_type === 'margin');
    const sportKey: SportKey = detectSport({
      sportName: match.league?.sport?.name_kr ?? null,
      leagueName: (match.league as { name_kr?: string } | null)?.name_kr ?? null,
      homeName: (match.home_team as { name_kr?: string } | null)?.name_kr ?? null,
      awayName: (match.away_team as { name_kr?: string } | null)?.name_kr ?? null,
      totalLine: parseLineNumber(uoForSport?.line_value),
      handicapLine: hcForSport?.line_value ? Math.abs(parseLineNumber(hcForSport.line_value) ?? 0) : null,
      marginThreshold: parseMarginThreshold(mgForSport?.line_value),
    });
    const sport = sportKey === 'baseball' ? 'baseball' : sportKey === 'soccer' ? 'soccer' : sportKey;
    console.log(`[Analyze] 종목 감지: ${SPORT_RULES[sportKey].name} (${sportKey})`);
    const homeEn = encodeURIComponent((match.home_team as { name_en?: string }).name_en ?? '');
    const awayEn = encodeURIComponent((match.away_team as { name_en?: string }).name_en ?? '');

    const [injuriesData, sofascoreData, pitchersData] = await Promise.allSettled([
      withTimeout(fetch(`${baseUrl}/api/external/injuries?match_id=${match.id}`).then(r => r.ok ? r.json() : null), 5000),
      // Sofascore: 전 종목 (상대전적 / 최근폼 / 결장자)
      homeEn && awayEn
        ? withTimeout(fetch(`${baseUrl}/api/external/sofascore?home=${homeEn}&away=${awayEn}&sport=${sportKey}`).then(r => r.ok ? r.json() : null), 10000)
        : Promise.resolve(null),
      // 야구: 선발 투수 성적 (MLB/KBO/NPB 자동 감지)
      sport === 'baseball'
        ? withTimeout(fetch(`${baseUrl}/api/external/pitchers?match_id=${match.id}`).then(r => r.ok ? r.json() : null), 20000)
        : Promise.resolve(null),
    ]);

    const pitchers = (pitchersData.status === 'fulfilled' ? pitchersData.value : null) as Record<string,unknown> | null;
    const injuries = (injuriesData.status === 'fulfilled' ? injuriesData.value : null) as Record<string,unknown> | null;
    const sofascore = (sofascoreData.status === 'fulfilled' ? sofascoreData.value : null) as {
      homeForm?: string; awayForm?: string;
      h2h?: { homeWins: number; awayWins: number; draws: number };
      missing?: { home: Array<{name:string;injury:string;expectedReturn:string|null}>; away: Array<{name:string;injury:string;expectedReturn:string|null}> };
    } | null;

    // 수집 결과를 로그로 남겨 데이터 누락을 바로 확인할 수 있게 한다
    {
      const ph = (pitchers?.home as { name?: string } | null)?.name;
      const pa = (pitchers?.away as { name?: string } | null)?.name;
      console.log(
        `[Analyze] 데이터 수집 — 투수: ${ph ?? '없음'} vs ${pa ?? '없음'}` +
        ` / 결장자DB: 홈 ${homeAbsences.length}건, 원정 ${awayAbsences.length}건` +
        ` / 외부부상: ${injuries ? '수신' : '없음'}` +
        ` / Sofascore: ${sofascore ? '수신' : '없음'}`,
      );
    }

    const betCombos = (match as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
    const prompt = buildAnalysisPrompt({ match, homeAbsences, awayAbsences, betCombos, pitchers, injuries, sofascore, sportKey });
    {
      const oi = prompt.indexOf('### 팀 소속');
      if (oi >= 0) {
        const seg = prompt.slice(oi, oi + 260).split('\n').slice(1, 3).join(' | ');
        console.log('[Analyze] 팀 소속 확인:', seg);
      }
    }

    const raw = await callAI(prompt);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답 파싱 실패');

    const result: AIAnalysis = JSON.parse(jsonMatch[0]);

    // ── 예상 스코어 분포 → 전 베팅 유형 확률 계산 ────────────────
    // AI는 "각 스코어 확률"만 예측하고, 유형별 확률은 여기서 기계적으로 도출한다.
    // 이 구조에서는 유형 간 모순(핸디 승+무 ≠ 승무패 승 등)이 발생할 수 없다.
    const rule = SPORT_RULES[sportKey];
    const uoLine = parseLineNumber(betCombos.find((c: BetCombo) => c.bet_type === 'under_over')?.line_value);
    const hcValue = parseHandicapValue(betCombos.find((c: BetCombo) => c.bet_type === 'handicap')?.line_value);
    const mgThreshold = parseMarginThreshold(betCombos.find((c: BetCombo) => c.bet_type === 'margin')?.line_value);

    const distOpts = {
      handicapValue: hcValue,
      totalLine: uoLine,
      marginThreshold: mgThreshold,
      hasDraw: rule.hasDraw,
    };
    const rawAny = result as unknown as {
      score_distribution?: ScoreProb[];
      margin_distribution?: MarginProb[];
      total_distribution?: TotalProb[];
    };

    // 고득점 종목(농구·배구)은 점수차+총점 분포, 그 외는 정확한 스코어 분포
    let derived = null;
    if (usesMarginTotalModel(sportKey)
        && Array.isArray(rawAny.margin_distribution) && rawAny.margin_distribution.length > 0
        && Array.isArray(rawAny.total_distribution) && rawAny.total_distribution.length > 0) {
      derived = deriveFromMarginTotal(rawAny.margin_distribution, rawAny.total_distribution, distOpts);
      if (derived) {
        console.log(`[Analyze] 점수차 ${rawAny.margin_distribution.length}개 + 총점 ${rawAny.total_distribution.length}개 → 예상 ${derived.expected_score} (${rule.name})`);
      }
    }
    const rawDist = rawAny.score_distribution;
    if (!derived && Array.isArray(rawDist) && rawDist.length > 0) {
      derived = deriveMarkets(rawDist, distOpts);
    }

    if (derived) {
      if (rawDist?.length) console.log(`[Analyze] 스코어 분포 ${rawDist.length}개 → 예상 ${derived.expected_score} (${rule.name})`);
      result.home_win_pct = derived.home_win_pct;
      result.draw_pct     = derived.draw_pct;
      result.away_win_pct = derived.away_win_pct;
      result.expected_score = derived.expected_score;
      result.winner_team = derived.implied.match_winner;
      if (hcValue != null) {
        result.handicap_home_pct = derived.handicap_home_pct;
        result.handicap_draw_pct = derived.handicap_draw_pct;
        result.handicap_away_pct = derived.handicap_away_pct;
      }
      if (uoLine != null) {
        result.under_pct = derived.under_pct;
        result.over_pct  = derived.over_pct;
      }
      result.odd_pct  = derived.odd_pct;
      result.even_pct = derived.even_pct;
      if (mgThreshold != null) {
        result.margin_home_pct = derived.margin_home_pct;
        result.margin_mid_pct  = derived.margin_mid_pct;
        result.margin_away_pct = derived.margin_away_pct;
      }
      // 예상 스코어가 각 유형에서 가리키는 항목 (UI에서 '예상' 배지로 표시)
      result.implied = derived.implied;

      // ── 추천도 분포에서 계산 ────────────────────────────────
      // 기존에는 AI가 자유롭게 써서 예상 스코어와 모순될 수 있었다
      // (예: 예상 1-0 인데 추천은 핸디캡 원정승)
      const ranked = rankOptions(derived, betCombos as unknown as Parameters<typeof rankOptions>[1]);
      if (ranked.length > 0) {
        const top = ranked[0];
        const prevType = result.best_bet_type;
        const prevOpt = result.best_bet_option;
        result.best_bet_type = top.betType;
        result.best_bet_option = `${top.label}${top.typeLabel ? ` (${top.typeLabel})` : ''}`;
        result.best_bet_reason =
          `예상 스코어 ${derived.expected_score} 기준, 발매된 항목 중 적중 확률이 ${top.pct}%로 가장 높다` +
          `${top.isExpected ? ' (예상 스코어와도 일치)' : ''}. 배당 ${top.odds}.`;
        if (prevType !== top.betType || prevOpt !== result.best_bet_option) {
          console.log(`[Analyze] 추천 교정: "${prevOpt ?? '-'}"(${prevType ?? '-'}) → "${result.best_bet_option}"(${top.betType}) ${top.pct}%`);
        }
      }
    } else {
      // 분포가 없을 때만 최소 보정 (구 모델 응답 대비)
      console.warn('[Analyze] score_distribution 없음 → AI가 적은 확률을 그대로 사용');
      if (!rule.hasDraw && (result.draw_pct ?? 0) > 0) {
        const d = result.draw_pct ?? 0;
        const h = result.home_win_pct ?? 50, a = result.away_win_pct ?? 50;
        const tot = h + a;
        result.draw_pct = 0;
        if (tot > 0) {
          result.home_win_pct = Math.round(h + d * (h / tot));
          result.away_win_pct = 100 - result.home_win_pct;
        }
      }
    }

    // 전반전(ht_*)은 분포로 계산되지 않으므로 종목 규칙만 적용
    if (!rule.hasDraw && (result.ht_draw_pct ?? 0) > 0) {
      const d = result.ht_draw_pct ?? 0;
      const h = result.ht_home_win_pct ?? 50, a = result.ht_away_win_pct ?? 50;
      const tot = h + a;
      result.ht_draw_pct = 0;
      if (tot > 0) {
        result.ht_home_win_pct = Math.round(h + d * (h / tot));
        result.ht_away_win_pct = 100 - result.ht_home_win_pct;
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

function buildAnalysisPrompt({ match, homeAbsences, awayAbsences, betCombos, pitchers, injuries, sofascore, sportKey }: {
  sportKey: SportKey;
  match: Match;
  homeAbsences: Array<Record<string, unknown>>;
  awayAbsences: Array<Record<string, unknown>>;
  betCombos: BetCombo[];
  pitchers: Record<string, unknown> | null;
  injuries: Record<string, unknown> | null;
  sofascore?: {
    homeForm?: string; awayForm?: string;
    h2h?: { homeWins: number; awayWins: number; draws: number };
    missing?: { home: Array<{name:string;injury:string;expectedReturn:string|null}>; away: Array<{name:string;injury:string;expectedReturn:string|null}> };
  } | null;
}): string {
  const homeAbsList = homeAbsences.map((a: Record<string, unknown>) => {
    const p = a.player as Record<string, unknown> | undefined;
    return `  - ${p?.name_en ?? '알 수 없음'} (${a.type}: ${a.reason ?? '-'})`;
  }).join('\n') || '  ※ 결장자 정보 미수집 (등록된 데이터 없음 — 결장자가 없다는 뜻이 아님)';

  const awayAbsList = awayAbsences.map((a: Record<string, unknown>) => {
    const p = a.player as Record<string, unknown> | undefined;
    return `  - ${p?.name_en ?? '알 수 없음'} (${a.type}: ${a.reason ?? '-'})`;
  }).join('\n') || '  ※ 결장자 정보 미수집 (등록된 데이터 없음 — 결장자가 없다는 뜻이 아님)';

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
    ...allHc.map(h => `[핸디캡 ${h.line_value ?? ''}]    홈 ${h.home_odds} / 무 ${h.draw_odds ?? '-'} / 원정 ${h.away_odds}`),
    ...betCombos.filter(c => c.bet_type === 'margin').map(m => `[마진 ${m.line_value ?? ''}]      승 ${m.home_odds} / 가운데 ${m.draw_odds ?? '-'} / 패 ${m.away_odds}`),
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
      if (!t) return '  ※ 정보 미수집 (결장자가 없다는 뜻이 아님)';
      const players = (t.players as Array<{ name: string; injury: string; status: string; chanceOfPlaying: number | null }>) ?? [];
      if (players.length === 0) return '  부상/결장자 없음 (출처에서 확인됨)';
      return players.map(p => {
        const chance = p.chanceOfPlaying != null ? ` (출전 가능성 ${p.chanceOfPlaying}%)` : '';
        return `  - ${p.name}: ${p.injury} [${p.status}]${chance}`;
      }).join('\n');
    };
    const src = (injuries.source as string) ?? '';
    extInjurySection = `\n## 공식 부상/결장자 [출처: ${src}]\n홈팀 (${homeName}):\n${fmt(injuries.home as Record<string,unknown>|null)}\n원정팀 (${awayName}):\n${fmt(injuries.away as Record<string,unknown>|null)}`;
  }

  // ── 분포 모델 안내 (종목별로 다름) ───────────────────────────
  // 축구·야구는 득점이 낮아 '정확한 스코어' 분포가 잘 맞는다.
  // 농구·배구는 90~240점대라 스코어 몇 개로는 분포를 담을 수 없으므로
  // 베팅 시장이 실제로 쓰는 축인 '점수차'와 '총점'을 따로 받는다.
  const distGuide = usesMarginTotalModel(sportKey)
    ? [
        '',
        '   이 종목은 득점이 많아 정확한 스코어 대신 두 가지 분포를 적는다.',
        '',
        '   (1) margin_distribution — 점수차(홈 - 원정) 분포',
        '       - diff 값을 2~3점 간격으로 12~20개 나열하고 각각의 확률을 적는다',
        '       - 음수는 원정 우세, 양수는 홈 우세',
        '       - ★ 농구는 20점 차 승부도 흔하다. 분포를 좁게 잡지 마라.',
        '         배당 1.29(≈67%)인 팀의 승률이 100%로 계산되면 분포가 틀린 것이다.',
        '       - 검산: 양수 확률의 합이 승무패 홈 배당 역산값과 ±10%p 안에 들어야 한다',
        '',
        '   (2) total_distribution — 양팀 총점 분포',
        '       - total 값을 4~6점 간격으로 10~16개 나열한다',
        '       - 언더오버 기준선 주변을 촘촘히 채워라 (한쪽으로 쏠리면 안 된다)',
        '       - 검산: 기준선 초과 확률의 합이 오버 배당 역산값과 ±10%p 안에 들어야 한다',
        '',
        '   두 분포 각각 확률 합계는 100.',
      ].join('\n')
    : [
        '',
        '   score_distribution 에 "각 스코어가 나올 확률"을 적는다.',
        '   - 가능성 높은 스코어 8~14개를 확률과 함께 나열한다',
        '   - 확률 합계는 100 (나머지 꼬리 확률은 비슷한 스코어에 흡수시킬 것)',
        '   - 이것이 이 분석의 핵심 결과물이다. 여기에 모든 판단을 담아라.',
      ].join('\n');

  const distSpec = usesMarginTotalModel(sportKey)
    ? [
        '  "margin_distribution": [',
        '    { "diff": -12, "prob": 8 }, { "diff": -8, "prob": 12 }, { "diff": -4, "prob": 15 },',
        '    { "diff": 0, "prob": 6 }, { "diff": 4, "prob": 14 }, { "diff": 8, "prob": 11 }',
        '  ],',
        '  "total_distribution": [',
        '    { "total": 210, "prob": 8 }, { "total": 220, "prob": 14 }, { "total": 230, "prob": 18 },',
        '    { "total": 240, "prob": 16 }, { "total": 250, "prob": 10 }',
        '  ],',
      ].join('\n')
    : [
        '  "score_distribution": [',
        '    { "home": 2, "away": 1, "prob": 15 },',
        '    { "home": 1, "away": 0, "prob": 12 },',
        '    { "home": 1, "away": 1, "prob": 11 }',
        '  ],',
      ].join('\n');

  // ── 팀명 접두사로 확인된 국가 정보 ───────────────────────────
  // 젠토토가 붙인 한 글자 국가 코드(U=UAE, J=요르단 …)는 추측이 아닌 확정 정보다
  const originLines = [
    describeTeamOrigin('홈팀', homeName),
    describeTeamOrigin('원정팀', awayName),
  ].filter(Boolean) as string[];
  const originSection = originLines.length > 0
    ? [
        '### 팀 소속 (팀명 표기로 확인됨)',
        ...originLines,
        '→ 두 팀 국가가 다르면 국제대회다. 아래 0단계에서 대회명을 판단할 것.',
      ].join('\n')
    : '※ 리그·국가 정보는 수집되지 않았다. 아래 0단계에서 네가 직접 식별할 것.';

  // ── 종목별 공식 규정 섹션 ──────────────────────────────────
  const uoCombo = betCombos.find(c => c.bet_type === 'under_over');
  const hcCombo = betCombos.find(c => c.bet_type === 'handicap');
  const mgCombo = betCombos.find(c => c.bet_type === 'margin');
  const sportRulesSection = buildSportRulesPrompt(sportKey, {
    totalLine: parseLineNumber(uoCombo?.line_value),
    handicapValue: parseHandicapValue(hcCombo?.line_value),
    marginThreshold: parseMarginThreshold(mgCombo?.line_value),
  });

  const isBaseballLeague = sportKey === 'baseball';
  const sportType = sportKey;

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

  return `당신은 전문 스포츠 애널리스트입니다. 아래의 실제 공식 데이터를 반드시 분석에 활용하세요. 추측이나 추정으로 채우지 말고, 제공된 데이터만을 근거로 분석하세요.

## 경기 정보
종목: ${leagueName} (${SPORT_RULES[sportKey].name})
경기: ${homeName} vs ${awayName}
${originSection}
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
${sofascore ? `
## 실시간 데이터 [Sofascore]
홈팀 최근 5경기 폼: ${sofascore.homeForm ?? '정보없음'} (W=승 D=무 L=패, 최신→과거)
원정팀 최근 5경기 폼: ${sofascore.awayForm ?? '정보없음'}
상대전적 (Sofascore 통계): 홈팀 ${sofascore.h2h?.homeWins ?? '?'}승 / 무 ${sofascore.h2h?.draws ?? '?'} / 원정팀 ${sofascore.h2h?.awayWins ?? '?'}승
${sofascore.missing?.home?.length ? `홈팀 결장자 (Sofascore): ${sofascore.missing.home.map(p => `${p.name}(${p.injury}${p.expectedReturn ? ', 복귀:'+p.expectedReturn : ''})`).join(', ')}` : '홈팀 결장자 (Sofascore): 없음'}
${sofascore.missing?.away?.length ? `원정팀 결장자 (Sofascore): ${sofascore.missing.away.map(p => `${p.name}(${p.injury}${p.expectedReturn ? ', 복귀:'+p.expectedReturn : ''})`).join(', ')}` : '원정팀 결장자 (Sofascore): 없음'}` : ''}

---

${sportRulesSection}

⚠️ 중요 일관성 규칙:
- expected_score의 총합이 언더오버 기준선보다 작으면 under_pct > over_pct 여야 함
- expected_score의 총합이 언더오버 기준선보다 크면 over_pct > under_pct 여야 함
- winner_team이 "home"이면 home_win_pct가 가장 높아야 함
- home_win_pct + draw_pct + away_win_pct = 100 이어야 함

아래 JSON 형식으로만 응답해 (마크다운 없이, 순수 JSON만):
{
  "home_country": "홈팀 소속 국가 (예: 일본). 모르면 \"불명\"",
  "away_country": "원정팀 소속 국가",
  "home_league": "홈팀 소속 리그 (예: J1리그). 모르면 \"불명\"",
  "away_league": "원정팀 소속 리그",
  "league_guess": "이 경기가 치러지는 대회명 (예: AFC 챔피언스리그 엘리트, MLB 정규시즌)",
  "team_knowledge": "두 팀에 대해 아는 내용 2~3문장 (리그 내 위치/전력/스타일). 모르면 \"해당 팀 정보 미확인\"",
${distSpec}
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
  "margin_home_pct": 마진_승_확률_정수_승1패승5패_없으면_null,
  "margin_mid_pct": 마진_가운데_확률_정수_없으면_null,
  "margin_away_pct": 마진_패_확률_정수_없으면_null,
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
  "best_bet_type": "match_winner 또는 handicap 또는 margin 또는 under_over 또는 sum 또는 ht_match_winner 또는 ht_handicap 또는 ht_under_over",
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

[★ 가장 중요 — 분석 절차는 반드시 이 순서를 따를 것]

0단계: 두 팀이 어느 나라·어느 리그 소속인지 먼저 식별한다.
   - 팀명으로 정확히 판단하라. 예: 가시마 앤틀러스=일본 J1리그, 꽁안 하노이=베트남 V리그1,
     상하이 하이강=중국 슈퍼리그, 탬파베이 레이스=미국 MLB, 흥국생명=한국 V-리그 여자부
   - ★ 두 팀이 같은 리그라고 섣불리 단정하지 마라. 배트맨은 국제대회를 자주 발매한다.
     한쪽만 아는 팀이면 다른 쪽은 십중팔구 다른 나라 팀이다. 모르면 "불명"이라고 적어라.
     예) 포트FC=태국, 부리람 유나이티드=태국, 조호르 다룰탁짐=말레이시아,
         꽁안 하노이=베트남, 상하이 하이강/베이징 궈안=중국, 이스트 벵골=인도,
         알쇼르타=이라크, 알시브=오만 — 이들이 일본/한국 팀과 붙으면 AFC 대회다.
   - 서로 다른 리그 소속이면 국제대회다(ACL 엘리트, ACL2, 클럽월드컵 등). 어느 대회인지 적어라.
   - 리그 수준 차이는 승부에 큰 영향을 준다. 예를 들어 J1리그 팀과 동남아 리그 팀이
     맞붙으면 전력 차가 크고, 원정 이동 거리·기후·잔디 적응도 변수가 된다.
   - 식별한 내용을 home_country / away_country / league_guess 필드에 반드시 적어라.
   - 팀을 특정할 수 없으면 해당 필드에 "불명"이라고 적고, 추측으로 지어내지 마라.

0-1단계: 식별한 팀에 대해 네가 알고 있는 지식을 끌어낸다.
   - 리그 내 위치(상위권/중위권/하위권), 최근 시즌 성적, 전력 수준
   - 홈/원정 성향, 전술 스타일(공격적/수비적), 득점·실점 경향
   - 다만 네 지식은 학습 시점 기준이라 최신이 아닐 수 있다.
     아래 제공된 실제 데이터(선발투수 성적 등)와 충돌하면 실제 데이터를 우선하라.
   - 모르는 팀이면 모른다고 밝히고 배당률을 주된 근거로 삼아라.

1단계: 제공된 실제 데이터를 빠짐없이 검토한다.
   - 선발 라인업/선발투수와 그 성적
   - 부상자·결장자 명단과 그 선수가 전력에서 차지하는 비중
   - 상대전적(H2H) 과 최근 경기 폼
   - 배당률이 말하는 시장의 판단
   ★ "미수집"으로 표시된 항목은 사실을 모른다는 뜻이다.
     이를 "결장자가 없다", "양팀 모두 베스트 멤버다" 처럼 단정하면 명백한 오류다.
     모르는 항목은 분석 글에서도 "정보 미확인"이라고 밝히고, 배당 등 다른 근거로 보완하라.
     반대로 "출처에서 확인됨"이라 적힌 항목만 사실로 단정할 수 있다.

2단계: 1단계를 종합해 확률 분포를 만든다. ${distGuide}

3단계: 승무패/핸디캡/언더오버/홀짝/마진 확률은 **절대 직접 쓰지 말 것.**
   시스템이 score_distribution 에서 기계적으로 계산한다.
   따로 적으면 무시되므로 분포를 정확히 만드는 데만 집중하라.

4단계: 분포가 1단계 데이터와 어긋나지 않는지 검산한다.
   예) 주전 공격수 2명이 결장인데 3골 이상 스코어에 높은 확률을 주지 않았는가?
       선발투수 ERA가 1점대인데 대량 실점 스코어가 과하지 않은가?

[유형 간 수학적 관계 — 절대 위반 금지]
★ 핵심: 핸디캡과 마진은 승무패 결과를 더 좁게 자른 "부분집합"이다.

① 핸디캡 H+X (홈팀에게 X점을 더해주는 경우):
   - 승 = (홈 실제점수 + X) > 원정 점수 → 홈이 지더라도 X점 미만 차이면 적중
   - 따라서 handicap_home_pct > home_win_pct (홈이 커버할 범위가 넓어짐)
   - 따라서 handicap_away_pct < away_win_pct (원정은 X점 초과로 이겨야 하므로 좁아짐)
   - 금지 예: 승무패 원정승 52%인데 H+2.5 원정승 79% → 수학적으로 불가능

② 핸디캡 H-X (홈팀에게서 X점을 빼는 경우):
   - 승 = (홈 실제점수 - X) > 원정 점수 → 홈이 X점 초과 차이로 이겨야 적중
   - 따라서 handicap_home_pct < home_win_pct
   - 따라서 handicap_away_pct > away_win_pct

③ 핸디캡 소수점(.5) 라인은 무(push)가 불가능 → handicap_draw_pct = 0 필수
   정수 라인(예: H-1.0)만 동점 가능 → handicap_draw_pct > 0

④ 마진 유형(승1패 / 승5패)은 핸디캡이 아니다. 완전히 다른 유형이다:
   - margin_home_pct(승) = 홈이 (임계값+1)점차 이상 승리 → 반드시 ≤ home_win_pct
   - margin_mid_pct(가운데) = 임계값 이내 점수차. 어느 팀이 이기든 무관, 무승부 포함
   - margin_away_pct(패) = 원정이 (임계값+1)점차 이상 승리 → 반드시 ≤ away_win_pct
   - margin_home_pct + margin_mid_pct + margin_away_pct = 100
   - 접전이 예상되면 margin_mid_pct가 가장 큰 값이 되는 것이 자연스럽다

⑤ 배당률 역산을 기준선으로 삼을 것:
   - 각 항목 확률 ≈ (1/해당배당) / (1/홈배당 + 1/무배당 + 1/원정배당) × 100
   - 예) 핸디 홈 1.20 / 원정 3.30 → 홈 ≈ 79%, 원정 ≈ 21%
   - 배당이 낮은 쪽이 확률이 높다. 이 관계를 절대 뒤집지 말 것.
   - 분석 근거가 뚜렷하지 않으면 배당 역산값에서 ±10%p 이내로만 조정할 것

규칙 요약:
- score_distribution 의 prob 합계 = 100 (가장 중요)
- score_distribution 은 8~14개 스코어를 담을 것. 3~4개만 쓰면 확률이 왜곡된다
- home/away 는 0 이상의 정수. 종목에 맞는 현실적인 점수대를 쓸 것
  (축구 0~5 / 야구 0~12 / 농구 60~130 / 배구는 세트 총득점 기준 60~110)
- 무승부가 없는 종목(야구·농구·배구)은 동점 스코어를 넣지 말 것
- *_pct 항목들은 시스템이 분포에서 계산하므로 적지 않아도 된다
- ht_* 전반 항목은 분포로 계산되지 않으므로 직접 추정해 적을 것 (각 합계 100)

[전력 분석 규칙]
- 제공된 공식 데이터(선발투수 성적/결장자/최근폼/상대전적)를 최우선 근거로 삼을 것
- 데이터가 없는 항목은 배당률 역산을 근거로 삼고, key_points에 "해당 정보 미확인 — 배당 기반 추정"이라고 명시할 것
- 데이터 없이 한쪽을 60% 이상으로 단정하지 말 것 (불확실성 반영해 55:45 수준 유지)
- 야구는 선발 투수가, 농구는 최근 폼과 에이스 출전 여부가, 배구는 세터·아웃사이드 히터 컨디션이 핵심 변수다`;
}

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
import { detectSport, parseLineNumber, parseHandicapValue, buildSportRulesPrompt, parseMarginThreshold, SPORT_RULES, type SportKey } from '@/lib/sports-rules';
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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
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
      // Sofascore: 축구만
      sport === 'soccer' && homeEn && awayEn
        ? withTimeout(fetch(`${baseUrl}/api/external/sofascore?home=${homeEn}&away=${awayEn}&sport=soccer`).then(r => r.ok ? r.json() : null), 10000)
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

    const betCombos = (match as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
    const prompt = buildAnalysisPrompt({ match, homeAbsences, awayAbsences, betCombos, pitchers, injuries, sofascore, sportKey });

    const raw = await callAI(prompt);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답 파싱 실패');

    const result: AIAnalysis = JSON.parse(jsonMatch[0]);

    // ── 일관성 후처리 1: 예상스코어 ↔ 언더오버 모순 수정 ──────────────
    if (result.expected_score && result.under_pct != null && result.over_pct != null) {
      const scoreMatch = result.expected_score.match(/(\d+)[:\-](\d+)/);
      if (scoreMatch) {
        const totalScore = parseInt(scoreMatch[1]) + parseInt(scoreMatch[2]);
        // 실제 배당 라인값 사용 (야구=5.5, 축구=2.5 등 실제 값)
        const uoBet = betCombos.find((c: BetCombo) => c.bet_type === 'under_over');
        const line = uoBet?.line_value ? parseFloat(String(uoBet.line_value)) : 2.5;
        if (totalScore <= line && result.over_pct > result.under_pct) {
          [result.under_pct, result.over_pct] = [result.over_pct, result.under_pct];
          console.log(`[Analyze] 일관성 교정: 예상${result.expected_score}(${totalScore}≤${line}) → 언더${result.under_pct}%/오버${result.over_pct}%`);
        } else if (totalScore > line && result.under_pct > result.over_pct) {
          [result.under_pct, result.over_pct] = [result.over_pct, result.under_pct];
          console.log(`[Analyze] 일관성 교정: 예상${result.expected_score}(${totalScore}>${line}) → 언더${result.under_pct}%/오버${result.over_pct}%`);
        }
      }
    }

    // ── 일관성 후처리 2: 종목 규정 기반 확률 교정 ──────────────────
    // 공식 규정: https://www.sportstoto.co.kr/proto_rules.php
    const rule = SPORT_RULES[sportKey];
    const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

    // (a) 무승부 없는 종목(야구/농구/배구)은 draw_pct 강제 0
    if (!rule.hasDraw) {
      if ((result.draw_pct ?? 0) > 0) {
        const d = result.draw_pct ?? 0;
        console.log(`[Analyze] ${rule.name}는 무승부 없음 → draw_pct ${d}% → 0%`);
        result.draw_pct = 0;
        // 홈/원정에 비례 배분
        const h = result.home_win_pct ?? 50, a = result.away_win_pct ?? 50;
        const tot = h + a;
        if (tot > 0) {
          result.home_win_pct = clampPct(h + d * (h / tot));
          result.away_win_pct = clampPct(100 - result.home_win_pct);
        }
      }
      if ((result.ht_draw_pct ?? 0) > 0) {
        const d = result.ht_draw_pct ?? 0;
        result.ht_draw_pct = 0;
        const h = result.ht_home_win_pct ?? 50, a = result.ht_away_win_pct ?? 50;
        const tot = h + a;
        if (tot > 0) {
          result.ht_home_win_pct = clampPct(h + d * (h / tot));
          result.ht_away_win_pct = clampPct(100 - result.ht_home_win_pct);
        }
      }
    }

    const homeWin = result.home_win_pct ?? 50;
    const awayWin = result.away_win_pct ?? 50;

    // (b) 마진 유형(승1패/승5패) 교정
    //     승 = 홈이 (임계값+1)점차 이상 승 → 승무패 홈승의 부분집합
    //     중간 = 임계값 이내 차(무승부 포함)
    //     패 = 원정이 (임계값+1)점차 이상 승 → 승무패 원정승의 부분집합
    const marginBet = betCombos.find((c: BetCombo) => c.bet_type === 'margin');
    if (marginBet && result.margin_home_pct != null && result.margin_away_pct != null) {
      let mh = clampPct(result.margin_home_pct);
      let ma = clampPct(result.margin_away_pct);
      let changed = false;
      if (mh > homeWin) { console.log(`[Analyze] 마진 교정: 승 ${mh}% → ${homeWin}% (승무패 홈승 초과 불가)`); mh = homeWin; changed = true; }
      if (ma > awayWin) { console.log(`[Analyze] 마진 교정: 패 ${ma}% → ${awayWin}% (승무패 원정승 초과 불가)`); ma = awayWin; changed = true; }
      if (mh + ma > 100) { const sc = 100 / (mh + ma); mh = clampPct(mh * sc); ma = clampPct(ma * sc); changed = true; }
      if (changed || result.margin_mid_pct == null) {
        result.margin_home_pct = mh;
        result.margin_away_pct = ma;
        result.margin_mid_pct = clampPct(100 - mh - ma);
      }
    }

    // (c) 핸디캡 교정 — 핸디캡 부호로 방향 판정 (배당 비교가 아니라 규정대로)
    //     H+X (홈 유리): handicap_home_pct > home_win_pct, handicap_away_pct < away_win_pct
    //     H-X (홈 불리): handicap_home_pct < home_win_pct, handicap_away_pct > away_win_pct
    const hcBet = betCombos.find((c: BetCombo) => c.bet_type === 'handicap');
    if (hcBet && result.handicap_home_pct != null && result.handicap_away_pct != null) {
      const hcVal = parseHandicapValue(hcBet.line_value);
      const hcHomeOdds = hcBet.home_odds ? parseFloat(String(hcBet.home_odds)) : null;
      const hcAwayOdds = hcBet.away_odds ? parseFloat(String(hcBet.away_odds)) : null;
      const hcDrawOdds = hcBet.draw_odds ? parseFloat(String(hcBet.draw_odds)) : null;

      // 소수점(.5) 핸디캡은 무(push) 불가
      const isHalfLine = hcVal != null && !Number.isInteger(hcVal);
      if (isHalfLine && (result.handicap_draw_pct ?? 0) > 0) {
        console.log(`[Analyze] 소수 핸디(${hcVal}) → handicap_draw_pct 0 강제`);
        result.handicap_draw_pct = 0;
      }
      const hcDraw = result.handicap_draw_pct ?? 0;

      // 배당 역산 확률 (vig 제거) — 시장가가 가장 신뢰할 수 있는 기준선
      let impliedHome: number | null = null;
      if (hcHomeOdds && hcAwayOdds) {
        const inv = 1 / hcHomeOdds + 1 / hcAwayOdds + (hcDrawOdds ? 1 / hcDrawOdds : 0);
        impliedHome = clampPct(100 / (hcHomeOdds * inv));
      }

      if (hcVal != null && impliedHome != null) {
        const aiHome = clampPct(result.handicap_home_pct);
        const dirOk = hcVal > 0 ? aiHome >= homeWin : aiHome <= homeWin;
        // AI 값이 배당 역산과 20%p 이상 어긋나거나 방향이 반대면 배당 기준으로 교정
        if (!dirOk || Math.abs(aiHome - impliedHome) > 20) {
          const newHome = impliedHome;
          const newAway = clampPct(100 - hcDraw - newHome);
          console.log(`[Analyze] 핸디 교정(H${hcVal > 0 ? '+' : ''}${hcVal}): 홈 ${aiHome}%→${newHome}%, 원정 ${result.handicap_away_pct}%→${newAway}% (배당역산 기준)`);
          result.handicap_home_pct = newHome;
          result.handicap_away_pct = newAway;
        }
      }
    }

    // (d) 언더오버 ↔ 핸디캡 합계 100% 보정
    if (result.under_pct != null && result.over_pct != null) {
      const t = result.under_pct + result.over_pct;
      if (t !== 100) result.over_pct = clampPct(100 - result.under_pct);
    }
    if (result.handicap_home_pct != null && result.handicap_away_pct != null) {
      const t = result.handicap_home_pct + (result.handicap_draw_pct ?? 0) + result.handicap_away_pct;
      if (t !== 100) result.handicap_away_pct = clampPct(100 - result.handicap_home_pct - (result.handicap_draw_pct ?? 0));
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

[확률 산출 절차 — 반드시 이 순서를 따를 것]
1단계: 제공된 데이터(선발투수/최근폼/상대전적/결장자)와 배당률을 종합해 가장 가능성 높은 최종 스코어를 정한다.
2단계: 그 스코어를 중심으로 "점수차 분포"를 머릿속에 그린다. (예: 1점차 35%, 2점차 25%, 3점차 이상 20%, ...)
3단계: 각 베팅 유형의 확률을 그 분포에서 역산한다. 유형별로 따로 추측하지 말 것.
4단계: 아래 수학적 관계가 모두 성립하는지 검산한다. 하나라도 깨지면 1단계로 돌아가 다시 계산한다.

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
- home_win_pct + draw_pct + away_win_pct = 100
- handicap_home_pct + handicap_draw_pct + handicap_away_pct = 100
- margin_home_pct + margin_mid_pct + margin_away_pct = 100
- under_pct + over_pct = 100 / odd_pct + even_pct = 100
- ht_* 항목들도 각각 합계 100

[전력 분석 규칙]
- 제공된 공식 데이터(선발투수 성적/결장자/최근폼/상대전적)를 최우선 근거로 삼을 것
- 데이터가 없는 항목은 배당률 역산을 근거로 삼고, key_points에 "해당 정보 미확인 — 배당 기반 추정"이라고 명시할 것
- 데이터 없이 한쪽을 60% 이상으로 단정하지 말 것 (불확실성 반영해 55:45 수준 유지)
- 야구는 선발 투수가, 농구는 최근 폼과 에이스 출전 여부가, 배구는 세터·아웃사이드 히터 컨디션이 핵심 변수다`;
}

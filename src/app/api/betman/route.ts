/**
 * GET /api/betman?round=xxx
 * 배트맨 회차별 경기 목록 반환
 *
 * 스크래퍼 서버(Python FastAPI)에 트리거를 보내거나
 * Supabase에서 기수집된 데이터를 조회
 */
import { NextResponse } from 'next/server';
import { getMatchesByRound } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const round = searchParams.get('round') ?? undefined;

  try {
    const matches = await getMatchesByRound(round);
    return NextResponse.json({ matches, total: matches.length });
  } catch (err) {
    console.error('Betman matches API error:', err);
    const raw = String((err as Error)?.cause ?? (err as Error)?.message ?? err);

    // 환경변수 누락 / DB 도달 불가를 구분해서 안내 (원인 모를 '조회 실패'만 뜨던 문제)
    let detail = raw;
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      detail = 'SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.';
    } else if (/fetch failed|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
      const host = (() => { try { return new URL(process.env.SUPABASE_URL!).host; } catch { return '(URL 파싱 실패)'; } })();
      detail = `Supabase 서버에 연결할 수 없습니다 (${host}). 프로젝트가 삭제되었거나 일시정지되었는지, SUPABASE_URL이 올바른지 확인하세요.`;
    } else if (/relation .* does not exist|schema cache/i.test(raw)) {
      detail = `테이블이 없습니다. supabase/schema.sql 을 SQL Editor에서 실행하세요. (${raw})`;
    } else if (/JWT|apikey|Invalid API key/i.test(raw)) {
      detail = 'Supabase 인증 키가 올바르지 않습니다. SUPABASE_SERVICE_KEY를 확인하세요.';
    }

    return NextResponse.json({ error: '경기 데이터 조회 실패', detail }, { status: 500 });
  }
}

// 스크래퍼 수동 트리거
export async function POST() {
  const scraperUrl = process.env.SCRAPER_API_URL;
  if (!scraperUrl) return NextResponse.json({ error: 'SCRAPER_API_URL 미설정' }, { status: 500 });

  try {
    const res = await fetch(`${scraperUrl}/trigger/betman`, { method: 'POST' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: '스크래퍼 트리거 실패', detail: String(err) }, { status: 500 });
  }
}

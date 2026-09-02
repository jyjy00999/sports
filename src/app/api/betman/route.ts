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
    return NextResponse.json({ error: '경기 데이터 조회 실패' }, { status: 500 });
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

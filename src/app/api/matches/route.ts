import { NextResponse } from 'next/server';
import type { Match, Competitor } from '@/types';

function safeTeam(c: Record<string, unknown>): Competitor {
  const team = (c.team as Record<string, unknown>) ?? {};
  const score = (c.score as string | undefined) ?? undefined;
  const records = (c.records as Array<Record<string, unknown>>) ?? [];
  const record = records.find((r) => r.type === 'total');
  return {
    id:           String(team.id ?? ''),
    name:         String(team.displayName ?? team.name ?? ''),
    shortName:    String(team.shortDisplayName ?? team.abbreviation ?? ''),
    abbreviation: String(team.abbreviation ?? ''),
    logo:         String((team.logos as Array<Record<string,unknown>>)?.[0]?.href ?? team.logo ?? ''),
    score:        score,
    winner:       Boolean(c.winner),
    record:       record ? `${record.summary}` : undefined,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const espnPath = searchParams.get('path'); // e.g. "soccer/kor.1"
  const leagueId = searchParams.get('league') ?? '';
  const leagueLabel = searchParams.get('label') ?? '';

  if (!espnPath) return NextResponse.json({ error: 'path 파라미터 필요' }, { status: 400 });

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 },
    });

    if (!res.ok) throw new Error(`ESPN API 오류: ${res.status}`);

    const data = await res.json() as Record<string, unknown>;
    const events = (data.events as Array<Record<string, unknown>>) ?? [];

    const matches: Match[] = events.map((ev) => {
      const comps = ((ev.competitions as Array<Record<string, unknown>>)?.[0]?.competitors as Array<Record<string, unknown>>) ?? [];
      const status = (ev.competitions as Array<Record<string, unknown>>)?.[0]?.status as Record<string, unknown> | undefined;
      const statusType = (status?.type as Record<string, unknown>) ?? {};
      const venue = ((ev.competitions as Array<Record<string, unknown>>)?.[0]?.venue as Record<string, unknown>) ?? {};

      const home = comps.find((c) => c.homeAway === 'home') ?? comps[0] ?? {};
      const away = comps.find((c) => c.homeAway === 'away') ?? comps[1] ?? {};

      const stateStr = String(statusType.state ?? 'pre');
      const statusMap: Record<string, Match['status']> = {
        pre:  'scheduled',
        in:   'inprogress',
        post: 'final',
      };

      return {
        id:           String(ev.id ?? ''),
        name:         String(ev.name ?? ''),
        date:         String(ev.date ?? ''),
        status:       statusMap[stateStr] ?? 'scheduled',
        statusDetail: String(statusType.shortDetail ?? statusType.description ?? ''),
        homeTeam:     safeTeam(home),
        awayTeam:     safeTeam(away),
        venue:        venue.fullName ? String(venue.fullName) : undefined,
        leagueId,
        leagueLabel,
      };
    });

    return NextResponse.json({ matches });
  } catch (err) {
    console.error('Matches API error:', err);
    return NextResponse.json({ error: '경기 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}

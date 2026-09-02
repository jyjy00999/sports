/**
 * DELETE /api/matches/delete-all
 * matches 테이블의 모든 경기를 삭제
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function DELETE() {
  try {
    // neq로 전체 삭제 (Supabase는 조건 없는 delete를 막으므로)
    const { data, error } = await supabase
      .from('matches')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('id');

    if (error) throw error;

    return NextResponse.json({ success: true, deleted: data?.length ?? 0 });
  } catch (err) {
    console.error('[delete-all]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

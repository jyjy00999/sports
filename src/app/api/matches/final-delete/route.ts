/**
 * DELETE /api/matches/final-delete
 * 종료(status='final') 경기를 DB에서 모두 삭제
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function DELETE() {
  try {
    const { data, error } = await supabase
      .from('matches')
      .delete()
      .eq('status', 'final')
      .select('id');

    if (error) throw error;

    return NextResponse.json({ success: true, deleted: data?.length ?? 0 });
  } catch (err) {
    console.error('[final-delete]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

// GET /api/fantasy/leaderboard?contestId=<uuid>
//
// Standings only — never a lineup. While the contest is still open we return
// the caller's own row and nothing else: publishing scores before lock would
// let a rival infer team composition from the movement of the numbers.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const contestId = searchParams.get('contestId')
  if (!contestId) return NextResponse.json({ error: 'Missing contestId' }, { status: 400 })

  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: contest, error: contestErr } = await admin
    .from('contests')
    .select('id, status, prize_pool, entry_fee, locks_at')
    .eq('id', contestId)
    .single()

  if (contestErr || !contest) return NextResponse.json({ error: 'Contest not found' }, { status: 404 })

  const { data: rows, error } = await admin
    .from('contest_entries')
    .select('id, user_id, total_points, rank, payout, profiles(display_name)')
    .eq('contest_id', contestId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const all = (rows ?? []).map(r => ({
    display_name: (r.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Unknown',
    total_points: r.total_points === null ? null : Number(r.total_points),
    rank:         r.rank,
    payout:       r.payout === null ? null : Number(r.payout),
    is_you:       !!user && r.user_id === user.id,
  }))

  const base = {
    status:     contest.status,
    locks_at:   contest.locks_at,
    entry_fee:  Number(contest.entry_fee),
    prize_pool: Number(contest.prize_pool),
    entrants:   all.length,
  }

  if (contest.status === 'open') {
    return NextResponse.json({ ...base, entries: all.filter(e => e.is_you) })
  }

  // Rank ascending, unranked (pre-settlement) by points descending.
  all.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank
    return (b.total_points ?? 0) - (a.total_points ?? 0)
  })

  return NextResponse.json({ ...base, entries: all })
}

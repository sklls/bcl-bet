import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { resolveSquad } from '@/lib/fantasy/squad'
import { validateLineup, lineupCost, SQUAD_SIZE } from '@/lib/fantasy/lineup'

const EntrySchema = z.object({
  contest_id:      z.string().uuid(),
  player_ids:      z.array(z.string().uuid()).length(SQUAD_SIZE),
  captain_id:      z.string().uuid(),
  vice_captain_id: z.string().uuid(),
})

// POST /api/fantasy/entry — join a contest, or replace an existing lineup.
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to enter a contest' }, { status: 401 })

  const body = await request.json()
  const parsed = EntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { contest_id, player_ids, captain_id, vice_captain_id } = parsed.data

  const admin = createAdminClient()

  const { data: contest, error: contestErr } = await admin
    .from('contests')
    .select('id, match_id, status, locks_at, entry_fee')
    .eq('id', contest_id)
    .single()

  if (contestErr || !contest) return NextResponse.json({ error: 'Contest not found' }, { status: 404 })
  if (contest.status !== 'open') return NextResponse.json({ error: 'This contest is no longer open' }, { status: 400 })
  if (new Date(contest.locks_at) <= new Date()) {
    return NextResponse.json({ error: 'This contest has locked' }, { status: 400 })
  }

  // Rebuild the pool server-side. The client's copy is a convenience; this is
  // the authority for credits, team membership and role.
  const squad = await resolveSquad(admin, contest.match_id)
  if (!squad.ok) return NextResponse.json({ error: squad.error }, { status: squad.status })

  const errors = validateLineup(
    { playerIds: player_ids, captainId: captain_id, viceCaptainId: vice_captain_id },
    squad.payload.players,
    squad.payload.sport,
  )
  if (errors.length) return NextResponse.json({ errors }, { status: 400 })

  // p_user_id is always the session user — never a value from the body.
  const { data, error } = await admin.rpc('enter_contest', {
    p_user_id:         user.id,
    p_contest_id:      contest_id,
    p_player_ids:      player_ids,
    p_captain_id:      captain_id,
    p_vice_captain_id: vice_captain_id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    success:  true,
    entry_id: data?.entry_id,
    charged:  data?.charged ?? false,
    cost:     lineupCost(player_ids, squad.payload.players),
  })
}

// GET /api/fantasy/entry?contestId=<uuid> — the caller's own entry, with its XI.
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ entry: null })

  const { searchParams } = new URL(request.url)
  const contestId = searchParams.get('contestId')
  if (!contestId) return NextResponse.json({ error: 'Missing contestId' }, { status: 400 })

  const admin = createAdminClient()
  const { data: entry } = await admin
    .from('contest_entries')
    .select('id, captain_id, vice_captain_id, total_points, rank, payout, entry_players(player_id)')
    .eq('contest_id', contestId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!entry) return NextResponse.json({ entry: null })

  return NextResponse.json({
    entry: {
      id:              entry.id,
      captain_id:      entry.captain_id,
      vice_captain_id: entry.vice_captain_id,
      total_points:    entry.total_points === null ? null : Number(entry.total_points),
      rank:            entry.rank,
      payout:          entry.payout === null ? null : Number(entry.payout),
      player_ids:      (entry.entry_players ?? []).map((p: { player_id: string }) => p.player_id),
    },
  })
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const FANTASY_SPORTS = ['cricket', 'football']

const CreateSchema = z.object({
  match_id:       z.string().uuid(),
  entry_fee:      z.number().min(0).max(100000).optional(),
  house_edge_pct: z.number().min(0).max(20).optional(),
  locks_at:       z.string().datetime().optional(),
})

const UpdateSchema = z.object({
  contest_id: z.string().uuid(),
  entry_fee:  z.number().min(0).max(100000).optional(),
  locks_at:   z.string().datetime().optional(),
  status:     z.enum(['open', 'locked']).optional(),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

async function entrantCount(admin: ReturnType<typeof createAdminClient>, contestId: string) {
  const { count } = await admin
    .from('contest_entries')
    .select('*', { count: 'exact', head: true })
    .eq('contest_id', contestId)
  return count ?? 0
}

// GET /api/admin/contests[?matchId=<uuid>]
// Contest state for the admin match list: status, entrants, pool, and whether
// every entry has been scored (settlement is refused until they have).
export async function GET(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('matchId')

  const admin = createAdminClient()
  let query = admin
    .from('contests')
    .select('id, match_id, entry_fee, house_edge_pct, status, prize_pool, locks_at, contest_entries(total_points)')
  if (matchId) query = query.eq('match_id', matchId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const contests = (data ?? []).map(c => {
    const entries = (c.contest_entries ?? []) as { total_points: number | null }[]
    return {
      id:         c.id,
      match_id:   c.match_id,
      entry_fee:  Number(c.entry_fee),
      status:     c.status,
      prize_pool: Number(c.prize_pool),
      locks_at:   c.locks_at,
      entrants:   entries.length,
      all_scored: entries.length > 0 && entries.every(e => e.total_points !== null),
    }
  })

  return NextResponse.json({ contests })
}

// POST /api/admin/contests — one contest per match.
export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { match_id, entry_fee, house_edge_pct, locks_at } = parsed.data
  const admin = createAdminClient()

  const { data: match, error: matchErr } = await admin
    .from('matches').select('id, sport, match_date').eq('id', match_id).single()

  if (matchErr || !match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (!FANTASY_SPORTS.includes(match.sport)) {
    return NextResponse.json({ error: `Fantasy is not available for ${match.sport}` }, { status: 400 })
  }

  const { data, error } = await admin
    .from('contests')
    .insert({
      match_id,
      entry_fee:      entry_fee ?? 100,
      house_edge_pct: house_edge_pct ?? 5,
      locks_at:       locks_at ?? match.match_date,
    })
    .select('id')
    .single()

  // UNIQUE (match_id) is the guard against a second contest on one fixture.
  if (error?.code === '23505') {
    return NextResponse.json({ error: 'This match already has a contest' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, contest_id: data.id })
}

// PATCH — editable only while open and unentered; changing the fee after
// someone has paid it would silently reprice their entry.
export async function PATCH(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { contest_id, entry_fee, locks_at, status } = parsed.data
  const admin = createAdminClient()

  const { data: contest } = await admin
    .from('contests').select('id, status').eq('id', contest_id).single()
  if (!contest) return NextResponse.json({ error: 'Contest not found' }, { status: 404 })
  if (contest.status !== 'open') {
    return NextResponse.json({ error: 'Only an open contest can be edited' }, { status: 409 })
  }

  // Locking is always allowed; repricing is not, once money is in.
  const repricing = entry_fee !== undefined
  if (repricing && (await entrantCount(admin, contest_id)) > 0) {
    return NextResponse.json({ error: 'Cannot change the entry fee once players have entered' }, { status: 409 })
  }

  const updates: Record<string, unknown> = {}
  if (entry_fee !== undefined) updates.entry_fee = entry_fee
  if (locks_at !== undefined) updates.locks_at = locks_at
  if (status !== undefined) updates.status = status
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin.from('contests').update(updates).eq('id', contest_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/contests?id=<contest_id> — only while nobody has entered.
export async function DELETE(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const contestId = searchParams.get('id')
  if (!contestId) return NextResponse.json({ error: 'Missing contest id' }, { status: 400 })

  const admin = createAdminClient()
  if ((await entrantCount(admin, contestId)) > 0) {
    return NextResponse.json({
      error: 'This contest has entries. Refunding entrants on deletion is not supported — settle it instead, which voids and refunds when there are too few players.',
    }, { status: 409 })
  }

  const { error } = await admin.from('contests').delete().eq('id', contestId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

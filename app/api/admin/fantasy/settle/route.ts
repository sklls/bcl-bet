import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { distributePrizes, MIN_ENTRANTS, type RankedEntry } from '@/lib/fantasy/prizes'

const SettleSchema = z.object({ contest_id: z.string().uuid() })

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// POST /api/admin/fantasy/settle — one-time. The RPC refuses a second call.
export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = SettleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { contest_id } = parsed.data
  const admin = createAdminClient()

  const { data: contest, error: contestErr } = await admin
    .from('contests')
    .select('id, status, entry_fee, prize_pool')
    .eq('id', contest_id)
    .single()

  if (contestErr || !contest) return NextResponse.json({ error: 'Contest not found' }, { status: 404 })
  if (contest.status === 'settled' || contest.status === 'void') {
    return NextResponse.json({ error: 'This contest is already settled' }, { status: 400 })
  }

  const { data: entries, error: entriesErr } = await admin
    .from('contest_entries')
    .select('id, user_id, total_points')
    .eq('contest_id', contest_id)
  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

  const rows = entries ?? []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'This contest has no entries to settle' }, { status: 400 })
  }

  const isVoid = rows.length < MIN_ENTRANTS

  // Settling before stats are saved would rank everyone at zero and pay the
  // wrong people. A void refunds regardless of points, so it is exempt.
  if (!isVoid && rows.some(r => r.total_points === null)) {
    return NextResponse.json({
      error: 'Some entries have no points yet — save match stats before settling.',
    }, { status: 400 })
  }

  const fee = Number(contest.entry_fee)

  const awards = isVoid
    ? rows.map(r => ({ entry_id: r.id, user_id: r.user_id, rank: null, amount: fee }))
    : distributePrizes(
        rows.map((r): RankedEntry => ({
          entry_id:     r.id,
          user_id:      r.user_id,
          total_points: Number(r.total_points),
        })),
        Number(contest.prize_pool),
      )

  const { data, error } = await admin.rpc('settle_contest', {
    p_contest_id: contest_id,
    p_awards:     awards,
    p_void:       isVoid,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    success:    true,
    void:       isVoid,
    reason:     isVoid ? `Fewer than ${MIN_ENTRANTS} entrants — entries refunded` : undefined,
    total_paid: Number(data?.total_paid ?? 0),
    settled:    data?.settled ?? 0,
  })
}

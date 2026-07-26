import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { settleMarket } from '@/lib/parimutuel'

const SettleSchema = z.object({
  market_id: z.string().uuid(),
  winning_option_id: z.string().uuid(),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? user : null
}

export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = SettleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { market_id, winning_option_id } = parsed.data
  const admin = createAdminClient()

  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('id, status, house_edge_pct, created_at, bet_options(id, total_amount_bet, seed_amount)')
    .eq('id', market_id)
    .single()

  if (marketErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }
  if (market.status === 'settled') {
    return NextResponse.json({ error: 'Market already settled' }, { status: 400 })
  }
  if (!market.bet_options.some((o: { id: string }) => o.id === winning_option_id)) {
    return NextResponse.json({ error: 'Winning option does not belong to this market' }, { status: 400 })
  }

  const { data: bets, error: betsErr } = await admin
    .from('bets')
    .select('id, user_id, bet_option_id, amount, placed_at')
    .eq('market_id', market_id)
    .eq('status', 'pending')

  if (betsErr) {
    return NextResponse.json({ error: betsErr.message }, { status: 500 })
  }

  const result = settleMarket({
    options: market.bet_options,
    bets: bets ?? [],
    winningOptionId: winning_option_id,
    houseEdgePct: Number(market.house_edge_pct),
    marketCreatedAt: market.created_at,
  })

  const isVoid = result.kind === 'void'
  const { data, error } = await admin.rpc('apply_settlement', {
    p_market_id: market_id,
    p_winning_option_id: winning_option_id,
    p_payouts: isVoid ? result.refunds : result.payouts,
    p_losing_bet_ids: isVoid ? [] : result.losingBetIds,
    p_void: isVoid,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    void: isVoid,
    reason: isVoid ? result.reason : undefined,
    house_take: isVoid ? 0 : result.houseTake,
    applied: data,
  })
}

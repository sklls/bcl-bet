import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { calculateOdds } from '@/lib/odds'

const BetSchema = z.object({
  market_id: z.string().uuid(),
  bet_option_id: z.string().uuid(),
  amount: z.number().positive().min(1),
})

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = BetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { market_id, bet_option_id, amount } = parsed.data
  const admin = createAdminClient()

  // Fetch market + options
  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('*, bet_options(*)')
    .eq('id', market_id)
    .single()

  if (marketErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }
  if (market.status !== 'open') {
    return NextResponse.json({ error: 'Market is not open for betting' }, { status: 400 })
  }

  // Verify bet_option belongs to this market
  const optionExists = market.bet_options.some((o: { id: string }) => o.id === bet_option_id)
  if (!optionExists) {
    return NextResponse.json({ error: 'Invalid bet option' }, { status: 400 })
  }

  // Calculate odds server-side (authoritative)
  const odds = calculateOdds(market.bet_options, bet_option_id, amount, market.house_edge_pct)

  // Place bet atomically via RPC
  const { data, error } = await admin.rpc('place_bet', {
    p_user_id: user.id,
    p_market_id: market_id,
    p_bet_option_id: bet_option_id,
    p_amount: amount,
    p_odds: odds,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, bet_id: (data as { bet_id: string }).bet_id, odds })
}

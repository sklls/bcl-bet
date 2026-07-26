import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

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

  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('id, status, bet_options(id)')
    .eq('id', market_id)
    .single()

  if (marketErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }
  if (market.status !== 'open') {
    return NextResponse.json({ error: 'Market is not open for betting' }, { status: 400 })
  }
  if (!market.bet_options.some((o: { id: string }) => o.id === bet_option_id)) {
    return NextResponse.json({ error: 'Invalid bet option' }, { status: 400 })
  }

  // No odds are locked. The stake buys a share of the pool, priced at settlement.
  const { data, error } = await admin.rpc('place_bet', {
    p_user_id: user.id,
    p_market_id: market_id,
    p_bet_option_id: bet_option_id,
    p_amount: amount,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, bet_id: (data as { bet_id: string }).bet_id })
}

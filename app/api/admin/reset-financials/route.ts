import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

/**
 * POST /api/admin/reset-financials
 * Body: { type: 'cash' | 'full' }
 *
 * 'cash'  — Deletes all positive topup transactions (resets "Total Cash Collected" to 0).
 *           Wallets and bet history are untouched.
 *
 * 'full'  — Nuclear reset — everything goes to 0:
 *           1. Zeros every user's wallet_balance
 *           2. Deletes ALL bets (clears staked/payout/house edge totals)
 *           3. Deletes ALL transactions
 *           4. Resets all market pools and bet_option totals to 0
 */
export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const type = body?.type

  if (type !== 'cash' && type !== 'full') {
    return NextResponse.json({ error: 'Invalid type. Use "cash" or "full".' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (type === 'cash') {
    // Delete all positive topup transactions only — resets the "Total Cash Collected" counter
    const { error } = await admin
      .from('transactions')
      .delete()
      .eq('type', 'topup')
      .gt('amount', 0)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, type: 'cash' })
  }

  if (type === 'full') {
    // 1. Zero all wallet balances
    const { error: walletError } = await admin
      .from('profiles')
      .update({ wallet_balance: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 })

    // 2. Delete ALL bets — this zeros Total Staked, Paid Out, House Edge
    const { error: betError } = await admin
      .from('bets')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (betError) return NextResponse.json({ error: betError.message }, { status: 500 })

    // 3. Delete ALL transactions — zeros Total Cash Collected
    const { error: txError } = await admin
      .from('transactions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 })

    // 4. Reset all market pools and bet_option totals to 0
    const { error: marketError } = await admin
      .from('markets')
      .update({ total_pool: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (marketError) return NextResponse.json({ error: marketError.message }, { status: 500 })

    const { error: optionError } = await admin
      .from('bet_options')
      .update({ total_amount_bet: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (optionError) return NextResponse.json({ error: optionError.message }, { status: 500 })

    return NextResponse.json({ success: true, type: 'full' })
  }
}

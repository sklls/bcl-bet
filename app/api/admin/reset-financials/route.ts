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

export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const type = body?.type

  if (type !== 'cash' && type !== 'full') {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const EPOCH = '2000-01-01'

  if (type === 'cash') {
    // Delete all positive topup transactions — resets "Total Cash Collected" to 0
    const { error } = await admin
      .from('transactions')
      .delete()
      .eq('type', 'topup')
      .gt('amount', 0)
      .gte('created_at', EPOCH)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // FULL RESET — run each step, collect errors
  const errors: string[] = []

  // 1. Zero all wallet balances
  const { error: e1 } = await admin
    .from('profiles')
    .update({ wallet_balance: 0 })
    .gte('created_at', EPOCH)
  if (e1) errors.push('wallets: ' + e1.message)

  // 2. Delete ALL bets (clears Total Staked, Paid Out, House Edge)
  const { error: e2 } = await admin
    .from('bets')
    .delete()
    .gte('placed_at', EPOCH)
  if (e2) errors.push('bets: ' + e2.message)

  // 3. Delete ALL transactions (clears Total Cash Collected)
  const { error: e3 } = await admin
    .from('transactions')
    .delete()
    .gte('created_at', EPOCH)
  if (e3) errors.push('transactions: ' + e3.message)

  // 4. Reset all market total_pool to 0
  const { error: e4 } = await admin
    .from('markets')
    .update({ total_pool: 0 })
    .gte('created_at', EPOCH)
  if (e4) errors.push('markets: ' + e4.message)

  // 5. Reset all bet_option totals to 0
  const { error: e5 } = await admin
    .from('bet_options')
    .update({ total_amount_bet: 0 })
    .gte('created_at', EPOCH)
  if (e5) errors.push('bet_options: ' + e5.message)

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(' | ') }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

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
 * 'cash'  — Deletes all topup transactions (resets "Total Cash Collected" counter only).
 *           Wallets and bet history are untouched.
 *
 * 'full'  — Nuclear reset:
 *           1. Zeros every user's wallet_balance
 *           2. Deletes ALL transactions
 *           3. Marks all pending bets as void (no refunds — balances already zeroed)
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
      .neq('id', '00000000-0000-0000-0000-000000000000') // match all rows

    if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 })

    // 2. Delete ALL transactions
    const { error: txError } = await admin
      .from('transactions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // match all rows

    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 })

    // 3. Void all pending bets (wallets are 0 so no refunds needed)
    const { error: betError } = await admin
      .from('bets')
      .update({ status: 'void' })
      .eq('status', 'pending')

    if (betError) return NextResponse.json({ error: betError.message }, { status: 500 })

    return NextResponse.json({ success: true, type: 'full' })
  }
}

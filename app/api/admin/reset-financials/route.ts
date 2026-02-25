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
 * 'cash'  — Resets "Total Cash Collected" to 0 (deletes positive topup transactions).
 *
 * 'full'  — Nuclear reset via raw SQL RPC:
 *           Zeros ALL wallets, deletes ALL bets, ALL transactions,
 *           resets all market pools and bet_option totals to 0.
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
    const { error } = await admin.rpc('reset_cash_collected')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, type: 'cash' })
  }

  if (type === 'full') {
    const { error } = await admin.rpc('reset_all_financials')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, type: 'full' })
  }
}

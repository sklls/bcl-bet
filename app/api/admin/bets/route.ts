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

// DELETE /api/admin/bets?id=<bet_id>
// Voids a single bet and refunds the user
export async function DELETE(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const betId = searchParams.get('id')
  if (!betId) return NextResponse.json({ error: 'Missing bet id' }, { status: 400 })

  const admin = createAdminClient()

  // Get the bet
  const { data: bet, error: fetchErr } = await admin
    .from('bets')
    .select('id, user_id, amount, status')
    .eq('id', betId)
    .single()

  if (fetchErr || !bet) return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
  if (bet.status !== 'pending') return NextResponse.json({ error: 'Only pending bets can be voided' }, { status: 400 })

  // Refund user
  await admin.rpc('topup_wallet', {
    p_user_id: bet.user_id,
    p_amount: bet.amount,
    p_description: 'Refund: bet voided by admin',
  })

  // Mark bet void
  const { error } = await admin
    .from('bets')
    .update({ status: 'void', settled_at: new Date().toISOString() })
    .eq('id', betId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, refunded: bet.amount })
}

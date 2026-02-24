import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

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

  const { error } = await admin.rpc('settle_market', {
    p_market_id: market_id,
    p_winning_option_id: winning_option_id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

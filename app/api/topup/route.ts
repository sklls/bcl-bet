import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const TopupSchema = z.object({
  target_user_id: z.string().uuid(),
  amount: z.number().positive().min(1),
  description: z.string().optional(),
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
  const parsed = TopupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { target_user_id, amount, description } = parsed.data
  const admin = createAdminClient()

  const { error } = await admin.rpc('topup_wallet', {
    p_user_id: target_user_id,
    p_amount: amount,
    p_description: description ?? `Manual top-up: ₹${amount}`,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const MarketSchema = z.object({
  match_id: z.string().uuid(),
  market_type: z.enum(['winner', 'top_scorer', 'over_under', 'live']),
  house_edge_pct: z.number().min(0).max(20).optional(),
  options: z.array(z.string().min(1)).min(2), // labels for bet options
})

const UpdateMarketSchema = z.object({
  market_id: z.string().uuid(),
  status: z.enum(['open', 'closed']).optional(),
})

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
  const parsed = MarketSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  const { match_id, market_type, house_edge_pct, options } = parsed.data
  const admin = createAdminClient()

  // Create market
  const { data: market, error: marketErr } = await admin
    .from('markets')
    .insert({ match_id, market_type, house_edge_pct: house_edge_pct ?? 5 })
    .select()
    .single()

  if (marketErr) return NextResponse.json({ error: marketErr.message }, { status: 500 })

  // Create bet options
  const optionRows = options.map((label) => ({ market_id: market.id, label }))
  const { error: optErr } = await admin.from('bet_options').insert(optionRows)
  if (optErr) return NextResponse.json({ error: optErr.message }, { status: 500 })

  return NextResponse.json({ success: true, market_id: market.id })
}

export async function PATCH(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = UpdateMarketSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { market_id, status } = parsed.data
  const admin = createAdminClient()

  const { error } = await admin
    .from('markets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', market_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

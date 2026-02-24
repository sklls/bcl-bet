import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const MatchSchema = z.object({
  team_a: z.string().min(1),
  team_b: z.string().min(1),
  match_date: z.string(),
  venue: z.string().optional(),
  over_under_line: z.number().optional(),
  cricheroes_url: z.string().url().optional(),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function GET() {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('matches')
    .select('*, markets(id, market_type, status, result, bet_options(id, label, total_amount_bet))')
    .order('match_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = MatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  const { cricheroes_url, ...rest } = parsed.data

  // Parse CricHeroes URL to extract matchId and slug
  let cricheroes_match_id: string | null = null
  let cricheroes_slug: string | null = null
  if (cricheroes_url) {
    const match = cricheroes_url.match(/cricheroes\.com\/scorecard\/(\d+)\/(.+?)(?:\/summary)?$/)
    if (match) {
      cricheroes_match_id = match[1]
      cricheroes_slug = match[2]
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('matches')
    .insert({ ...rest, cricheroes_match_id, cricheroes_slug })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

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
    .select('*, markets(id, market_type, status, result, bet_options(id, label, total_amount_bet, bets(id, user_id, amount, status, placed_at, profiles(display_name))))')
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

// DELETE /api/admin/matches?id=<match_id>
// Voids all pending bets (refunds users), then deletes the match (cascades markets/bet_options/bets)
export async function DELETE(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('id')
  if (!matchId) return NextResponse.json({ error: 'Missing match id' }, { status: 400 })

  const admin = createAdminClient()

  // Find all pending bets for this match's markets and refund them
  const { data: pendingBets } = await admin
    .from('bets')
    .select('id, user_id, amount, market_id, markets!inner(match_id)')
    .eq('markets.match_id', matchId)
    .eq('status', 'pending')

  if (pendingBets && pendingBets.length > 0) {
    for (const bet of pendingBets) {
      // Refund wallet via RPC
      await admin.rpc('topup_wallet', {
        p_user_id: bet.user_id,
        p_amount: bet.amount,
        p_description: 'Refund: match deleted by admin',
      })
      // Mark bet void
      await admin.from('bets').update({ status: 'void' }).eq('id', bet.id)
    }
  }

  // Delete the match (cascades to markets, bet_options, bets via FK ON DELETE CASCADE)
  const { error } = await admin.from('matches').delete().eq('id', matchId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, refunded: pendingBets?.length ?? 0 })
}

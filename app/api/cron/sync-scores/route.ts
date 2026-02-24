import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import type { CricHeroesMatchData } from '@/app/api/cricheroes/route'

// Called by Vercel Cron every minute for live matches
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Fetch all live matches that have a CricHeroes ID
  const { data: liveMatches, error } = await admin
    .from('matches')
    .select('id, cricheroes_match_id, cricheroes_slug, team_a, team_b')
    .eq('status', 'live')
    .not('cricheroes_match_id', 'is', null)

  if (error) {
    console.error('Cron: failed to fetch live matches', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!liveMatches || liveMatches.length === 0) {
    return NextResponse.json({ message: 'No live matches to sync' })
  }

  const results = await Promise.allSettled(
    liveMatches.map((match) => syncMatch(match, admin))
  )

  const synced = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length

  return NextResponse.json({ synced, failed })
}

async function syncMatch(
  match: {
    id: string
    cricheroes_match_id: string
    cricheroes_slug: string | null
    team_a: string
    team_b: string
  },
  admin: ReturnType<typeof createAdminClient>
) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const params = new URLSearchParams({ matchId: match.cricheroes_match_id })
  if (match.cricheroes_slug) params.set('slug', match.cricheroes_slug)

  const res = await fetch(`${baseUrl}/api/cricheroes?${params}`)
  if (!res.ok) throw new Error(`CricHeroes fetch failed for match ${match.id}`)

  const data: CricHeroesMatchData = await res.json()

  // Build update payload
  const update: Record<string, string | null> = {
    live_score_a: data.score_a,
    live_score_b: data.score_b,
    live_overs_a: data.overs_a,
    live_overs_b: data.overs_b,
    live_crr: data.crr_a,
    updated_at: new Date().toISOString(),
  }

  // If match is completed, update status
  if (data.status === 'past') {
    update.status = 'completed'
  }

  await admin.from('matches').update(update).eq('id', match.id)

  // Auto-settle winner market if match ended
  if (data.status === 'past' && data.winning_team) {
    await autoSettleWinner(match.id, data.winning_team, admin)
    await autoSettleTopScorer(match.id, data.top_batters, admin)
  }
}

async function autoSettleWinner(
  matchId: string,
  winningTeam: string,
  admin: ReturnType<typeof createAdminClient>
) {
  // Find unsettled winner market
  const { data: market } = await admin
    .from('markets')
    .select('id, bet_options(*)')
    .eq('match_id', matchId)
    .eq('market_type', 'winner')
    .neq('status', 'settled')
    .single()

  if (!market) return

  // Find the winning option (fuzzy match on team name)
  const winningOption = (market.bet_options as { id: string; label: string }[]).find((o) =>
    o.label.toLowerCase().includes(winningTeam.toLowerCase()) ||
    winningTeam.toLowerCase().includes(o.label.toLowerCase())
  )

  if (!winningOption) {
    console.warn(`Could not find winning option for team "${winningTeam}" in market ${market.id}`)
    return
  }

  await admin.rpc('settle_market', {
    p_market_id: market.id,
    p_winning_option_id: winningOption.id,
  })
}

async function autoSettleTopScorer(
  matchId: string,
  topBatters: CricHeroesMatchData['top_batters'],
  admin: ReturnType<typeof createAdminClient>
) {
  if (!topBatters.length) return

  // Find top scorer (highest runs)
  const topScorer = topBatters.reduce((prev, curr) =>
    curr.runs > prev.runs ? curr : prev
  )

  const { data: market } = await admin
    .from('markets')
    .select('id, bet_options(*)')
    .eq('match_id', matchId)
    .eq('market_type', 'top_scorer')
    .neq('status', 'settled')
    .single()

  if (!market) return

  const winningOption = (market.bet_options as { id: string; label: string }[]).find((o) =>
    o.label.toLowerCase().includes(topScorer.player_name.toLowerCase()) ||
    topScorer.player_name.toLowerCase().includes(o.label.toLowerCase())
  )

  if (!winningOption) {
    console.warn(`Could not find top scorer option for "${topScorer.player_name}"`)
    return
  }

  await admin.rpc('settle_market', {
    p_market_id: market.id,
    p_winning_option_id: winningOption.id,
  })
}

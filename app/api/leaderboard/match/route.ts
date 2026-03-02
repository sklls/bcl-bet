import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const matchId = req.nextUrl.searchParams.get('matchId')
  if (!matchId) return NextResponse.json({ error: 'matchId required' }, { status: 400 })

  const supabase = createAdminClient()

  // Fetch all bets for markets belonging to this match
  const { data: bets, error } = await supabase
    .from('bets')
    .select('user_id, amount, status, payout, profiles(display_name), markets!inner(match_id)')
    .eq('markets.match_id', matchId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate per player
  const playerMap: Record<string, {
    display_name: string
    total_staked: number
    total_winnings: number
    total_bets: number
    bets_won: number
  }> = {}

  for (const bet of (bets ?? [])) {
    const uid = bet.user_id
    const name = (bet.profiles as { display_name: string } | null)?.display_name ?? 'Unknown'
    if (!playerMap[uid]) {
      playerMap[uid] = { display_name: name, total_staked: 0, total_winnings: 0, total_bets: 0, bets_won: 0 }
    }
    playerMap[uid].total_staked += Number(bet.amount)
    playerMap[uid].total_bets += 1
    if (bet.status === 'won') {
      playerMap[uid].total_winnings += Number(bet.payout ?? 0)
      playerMap[uid].bets_won += 1
    }
  }

  const players = Object.values(playerMap)
    .map(p => ({ ...p, net_pl: p.total_winnings - p.total_staked }))
    .sort((a, b) => b.net_pl - a.net_pl)

  return NextResponse.json(players)
}

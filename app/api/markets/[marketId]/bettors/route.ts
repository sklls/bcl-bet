import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function GET(_req: Request, { params }: { params: { marketId: string } }) {
  const supabase = createAdminClient()

  const [{ data: market }, { data: bets }] = await Promise.all([
    supabase.from('markets').select('created_at').eq('id', params.marketId).single(),
    supabase
      .from('bets')
      .select('bet_option_id, placed_at, profiles(display_name)')
      .eq('market_id', params.marketId)
      .order('placed_at', { ascending: true }),
  ])

  const createdAt = market?.created_at ? new Date(market.created_at) : new Date()
  const earlyBirdCutoff = new Date(createdAt.getTime() + 30 * 60 * 1000) // 30 min window

  const bettorsByOption: Record<string, { name: string; early: boolean }[]> = {}

  for (const bet of (bets ?? [])) {
    const name = (bet.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Unknown'
    const early = new Date(bet.placed_at) < earlyBirdCutoff
    if (!bettorsByOption[bet.bet_option_id]) bettorsByOption[bet.bet_option_id] = []
    bettorsByOption[bet.bet_option_id].push({ name, early })
  }

  return NextResponse.json({ bettors: bettorsByOption, marketCreatedAt: market?.created_at ?? null })
}

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const BET_STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  won: 'text-green-400',
  lost: 'text-red-400',
  void: 'text-gray-400',
}

const TX_COLORS: Record<string, string> = {
  bet: 'text-red-400',
  win: 'text-green-400',
  topup: 'text-blue-400',
  refund: 'text-yellow-400',
}

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: bets }, { data: transactions }, { data: estimates }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('bets')
      .select(`
        id, amount, odds_at_placement, status, payout, placed_at,
        markets(market_type, title, result, matches(team_a, team_b)),
        bet_options(label)
      `)
      .eq('user_id', user.id)
      .order('placed_at', { ascending: false }),
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    // Live expected payout for each pending bet (true pari-mutuel, current pool)
    supabase.rpc('get_bet_estimates', { p_user_id: user.id }),
  ])

  // Map bet_id → current expected payout
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estimateMap = new Map<string, number>((estimates ?? []).map((e: any) => [e.bet_id, Number(e.expected_payout)]))

  const settledBets = (bets ?? []).filter((b: { status: string }) => ['won', 'lost'].includes(b.status))
  const totalWon = (bets ?? []).filter((b: { status: string }) => b.status === 'won').length
  const totalBets = (bets ?? []).length
  const winRate = settledBets.length > 0 ? ((totalWon / settledBets.length) * 100).toFixed(0) : null

  // Net profit = total won payouts - total staked on settled bets
  const totalStaked = settledBets.reduce((s: number, b: { amount: number }) => s + Number(b.amount), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPayouts = settledBets.filter((b: any) => b.status === 'won').reduce((s: number, b: { payout: number }) => s + Number(b.payout ?? 0), 0)
  const netProfit = totalPayouts - totalStaked
  const roi = totalStaked > 0 ? ((netProfit / totalStaked) * 100).toFixed(1) : null

  const totalWinnings = (transactions ?? [])
    .filter((t: { type: string }) => t.type === 'win')
    .reduce((sum: number, t: { amount: number }) => sum + Number(t.amount), 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">My Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">{profile?.display_name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Balance</p>
          <p className="text-xl font-bold text-green-400">₹{Number(profile?.wallet_balance ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Bets</p>
          <p className="text-xl font-bold text-white">{totalWon} / {settledBets.length}</p>
          <p className="text-xs text-gray-600 mt-0.5">won · settled{totalBets > settledBets.length ? ` · ${totalBets - settledBets.length} pending` : ''}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Win Rate</p>
          <p className={`text-xl font-bold ${winRate !== null && parseInt(winRate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {winRate !== null ? `${winRate}%` : '—'}
          </p>
          {winRate !== null && <p className="text-xs text-gray-600 mt-0.5">of settled bets</p>}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Net Profit</p>
          <p className={`text-xl font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {netProfit >= 0 ? '+' : ''}₹{netProfit.toLocaleString()}
          </p>
          {roi !== null && <p className="text-xs text-gray-600 mt-0.5">ROI: {roi}%</p>}
        </div>
      </div>

      {/* My Bets */}
      <div>
        <h2 className="text-lg font-semibold mb-3">My Bets</h2>
        {(bets ?? []).length === 0 ? (
          <p className="text-gray-500 text-sm">No bets placed yet. <a href="/" className="text-green-400 underline">Browse matches</a></p>
        ) : (
          <div className="space-y-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(bets ?? []).map((bet: any) => {
                const expectedPayout = bet.status === 'pending' ? estimateMap.get(bet.id) ?? null : null
                return (
                  <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {bet.markets?.matches?.team_a} vs {bet.markets?.matches?.team_b}
                      </p>
                      <p className="text-xs text-gray-400">
                        {bet.bet_options?.label} · {bet.markets?.market_type === 'custom' && bet.markets?.title ? bet.markets.title : bet.markets?.market_type?.replace('_', ' ')}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {format(new Date(bet.placed_at), 'dd MMM, h:mm a')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white">₹{Number(bet.amount).toLocaleString()} <span className="text-xs text-gray-500">@ {Number(bet.odds_at_placement).toFixed(2)}x</span></p>
                      {bet.status === 'pending' && expectedPayout !== null ? (
                        <div>
                          <p className="text-xs text-yellow-400 font-medium">PENDING</p>
                          <p className="text-xs text-gray-400">
                            Est. return: <span className="text-yellow-300 font-semibold">₹{expectedPayout.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          </p>
                        </div>
                      ) : (
                        <p className={`text-sm font-semibold ${BET_STATUS_COLORS[bet.status] ?? 'text-gray-400'}`}>
                          {bet.status === 'won' ? `+₹${Number(bet.payout).toLocaleString()}` : bet.status.toUpperCase()}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>
        {(transactions ?? []).length === 0 ? (
          <p className="text-gray-500 text-sm">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {(transactions ?? []).map((tx: { id: string; type: string; amount: number; description: string | null; created_at: string }) => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-800">
                <div>
                  <p className="text-sm text-gray-300">{tx.description ?? tx.type}</p>
                  <p className="text-xs text-gray-500">{format(new Date(tx.created_at), 'dd MMM yyyy, h:mm a')}</p>
                </div>
                <p className={`text-sm font-semibold ${TX_COLORS[tx.type] ?? 'text-gray-400'}`}>
                  {tx.amount > 0 ? '+' : ''}₹{Number(tx.amount).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

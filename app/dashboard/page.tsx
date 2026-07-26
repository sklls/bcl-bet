import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const BET_STATUS_COLORS: Record<string, string> = {
  pending: 'text-gold',
  won: 'text-amber',
  lost: 'text-crimson-light',
  void: 'text-slate',
}

const TX_COLORS: Record<string, string> = {
  bet: 'text-crimson-light',
  win: 'text-amber',
  topup: 'text-slate',
  refund: 'text-gold',
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
    supabase.rpc('get_bet_estimates', { p_user_id: user.id }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estimateMap = new Map<string, number>((estimates ?? []).map((e: any) => [e.bet_id, Number(e.expected_payout)]))

  const settledBets = (bets ?? []).filter((b: { status: string }) => ['won', 'lost'].includes(b.status))
  const totalWon = (bets ?? []).filter((b: { status: string }) => b.status === 'won').length
  const totalBets = (bets ?? []).length
  const winRate = settledBets.length > 0 ? ((totalWon / settledBets.length) * 100).toFixed(0) : null

  const totalStaked = settledBets.reduce((s: number, b: { amount: number }) => s + Number(b.amount), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPayouts = settledBets.filter((b: any) => b.status === 'won').reduce((s: number, b: { payout: number }) => s + Number(b.payout ?? 0), 0)
  const netProfit = totalPayouts - totalStaked
  const roi = totalStaked > 0 ? ((netProfit / totalStaked) * 100).toFixed(1) : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">My Dashboard</h1>
        <p className="text-slate text-sm mt-1">{profile?.display_name}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Balance</p>
          <p className="text-xl font-bold text-amber">₹{Number(profile?.wallet_balance ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Bets</p>
          <p className="text-xl font-bold text-white">{totalWon} / {settledBets.length}</p>
          <p className="text-xs text-slate mt-0.5">won · settled{totalBets > settledBets.length ? ` · ${totalBets - settledBets.length} pending` : ''}</p>
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Win Rate</p>
          <p className={`text-xl font-bold ${winRate !== null && parseInt(winRate) >= 50 ? 'text-amber' : 'text-crimson-light'}`}>
            {winRate !== null ? `${winRate}%` : '—'}
          </p>
          {winRate !== null && <p className="text-xs text-slate mt-0.5">of settled bets</p>}
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Net Profit</p>
          <p className={`text-xl font-bold ${netProfit >= 0 ? 'text-amber' : 'text-crimson-light'}`}>
            {netProfit >= 0 ? '+' : ''}₹{netProfit.toLocaleString()}
          </p>
          {roi !== null && <p className="text-xs text-slate mt-0.5">ROI: {roi}%</p>}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">My Bets</h2>
        {(bets ?? []).length === 0 ? (
          <p className="text-slate text-sm">No bets placed yet. <a href="/" className="text-amber underline">Browse matches</a></p>
        ) : (
          <div className="space-y-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(bets ?? []).map((bet: any) => {
                const expectedPayout = bet.status === 'pending' ? estimateMap.get(bet.id) ?? null : null
                return (
                  <div key={bet.id} className="bg-table border border-rail rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {bet.markets?.matches?.team_a} vs {bet.markets?.matches?.team_b}
                      </p>
                      <p className="text-xs text-slate">
                        {bet.bet_options?.label} · {bet.markets?.market_type === 'custom' && bet.markets?.title ? bet.markets.title : bet.markets?.market_type?.replace('_', ' ')}
                      </p>
                      <p className="text-xs text-slate mt-0.5">
                        {format(new Date(bet.placed_at), 'dd MMM, h:mm a')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white">₹{Number(bet.amount).toLocaleString()} <span className="text-xs text-slate">{bet.odds_at_placement == null ? 'pari-mutuel' : `@ ${Number(bet.odds_at_placement).toFixed(2)}x`}</span></p>
                      {bet.status === 'pending' && expectedPayout !== null ? (
                        <div>
                          <p className="text-xs text-gold font-medium">PENDING</p>
                          <p className="text-xs text-slate">
                            Est. return: <span className="text-gold font-semibold">₹{expectedPayout.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          </p>
                        </div>
                      ) : (
                        <p className={`text-sm font-semibold ${BET_STATUS_COLORS[bet.status] ?? 'text-slate'}`}>
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

      <div>
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>
        {(transactions ?? []).length === 0 ? (
          <p className="text-slate text-sm">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {(transactions ?? []).map((tx: { id: string; type: string; amount: number; description: string | null; created_at: string }) => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-rail">
                <div>
                  <p className="text-sm text-slate">{tx.description ?? tx.type}</p>
                  <p className="text-xs text-slate">{format(new Date(tx.created_at), 'dd MMM yyyy, h:mm a')}</p>
                </div>
                <p className={`text-sm font-semibold ${TX_COLORS[tx.type] ?? 'text-slate'}`}>
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

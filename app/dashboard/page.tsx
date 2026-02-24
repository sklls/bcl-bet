import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

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

  const [{ data: profile }, { data: bets }, { data: transactions }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('bets')
      .select(`
        id, amount, odds_at_placement, status, payout, placed_at,
        markets(market_type, result, matches(team_a, team_b)),
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
  ])

  const totalWon = (bets ?? []).filter((b: { status: string }) => b.status === 'won').length
  const totalBets = (bets ?? []).length
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
        {[
          { label: 'Balance', value: `₹${Number(profile?.wallet_balance ?? 0).toLocaleString()}`, color: 'text-green-400' },
          { label: 'Total Bets', value: totalBets, color: 'text-white' },
          { label: 'Bets Won', value: totalWon, color: 'text-green-400' },
          { label: 'Total Winnings', value: `₹${totalWinnings.toLocaleString()}`, color: 'text-yellow-400' },
        ].map((stat) => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* My Bets */}
      <div>
        <h2 className="text-lg font-semibold mb-3">My Bets</h2>
        {(bets ?? []).length === 0 ? (
          <p className="text-gray-500 text-sm">No bets placed yet. <a href="/" className="text-green-400 underline">Browse matches</a></p>
        ) : (
          <div className="space-y-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(bets ?? []).map((bet: any) => (
              <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">
                    {bet.markets?.matches?.team_a} vs {bet.markets?.matches?.team_b}
                  </p>
                  <p className="text-xs text-gray-400">
                    {bet.bet_options?.label} · {bet.markets?.market_type?.replace('_', ' ')}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {format(new Date(bet.placed_at), 'dd MMM, h:mm a')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white">₹{Number(bet.amount).toLocaleString()} <span className="text-xs text-gray-500">@ {Number(bet.odds_at_placement).toFixed(2)}x</span></p>
                  <p className={`text-sm font-semibold ${BET_STATUS_COLORS[bet.status] ?? 'text-gray-400'}`}>
                    {bet.status === 'won' ? `+₹${Number(bet.payout).toLocaleString()}` : bet.status.toUpperCase()}
                  </p>
                </div>
              </div>
            ))}
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

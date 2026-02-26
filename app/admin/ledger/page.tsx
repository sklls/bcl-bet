import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400 bg-yellow-400/10',
  won:     'text-green-400 bg-green-400/10',
  lost:    'text-red-400 bg-red-400/10',
  void:    'text-gray-400 bg-gray-400/10',
}

export default async function LedgerPage() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  // Fetch all bets with full context
  const { data: bets } = await admin
    .from('bets')
    .select(`
      id, amount, odds_at_placement, status, payout, placed_at, settled_at,
      profiles(display_name),
      markets(market_type, result, matches(team_a, team_b, match_date)),
      bet_options(label)
    `)
    .order('placed_at', { ascending: false })

  // Aggregate stats per user
  const userMap: Record<string, {
    name: string
    totalStaked: number
    totalPayout: number
    won: number
    lost: number
    pending: number
  }> = {}

  for (const bet of bets ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = bet as any
    const name = b.profiles?.display_name ?? 'Unknown'
    if (!userMap[name]) {
      userMap[name] = { name, totalStaked: 0, totalPayout: 0, won: 0, lost: 0, pending: 0 }
    }
    userMap[name].totalStaked += Number(b.amount)
    if (b.status === 'won')     { userMap[name].totalPayout += Number(b.payout ?? 0); userMap[name].won++ }
    if (b.status === 'lost')    { userMap[name].lost++ }
    if (b.status === 'pending') { userMap[name].pending++ }
  }

  const userSummaries = Object.values(userMap).sort((a, b) => b.totalStaked - a.totalStaked)

  const totalStaked  = (bets ?? []).reduce((s, b) => s + Number(b.amount), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPaidOut = (bets ?? []).filter((b: any) => b.status === 'won').reduce((s, b) => s + Number((b as any).payout ?? 0), 0)
  const houseEdge    = totalStaked - totalPaidOut

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">📒 Ledger</h1>
        <p className="text-gray-400 text-sm mt-1">All bets placed across all users and matches</p>
      </div>

      {/* Totals banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Bets</p>
          <p className="text-2xl font-bold text-white">{(bets ?? []).length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Staked</p>
          <p className="text-2xl font-bold text-white">₹{totalStaked.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Paid Out</p>
          <p className="text-2xl font-bold text-green-400">₹{totalPaidOut.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">House Edge</p>
          <p className="text-2xl font-bold text-yellow-400">₹{houseEdge.toLocaleString()}</p>
        </div>
      </div>

      {/* Per-user summary */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Per-User Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 pr-4">User</th>
                <th className="text-right py-2 pr-4">Staked</th>
                <th className="text-right py-2 pr-4">Paid Out</th>
                <th className="text-right py-2 pr-4">Net P&L</th>
                <th className="text-right py-2 pr-4">Won</th>
                <th className="text-right py-2 pr-4">Lost</th>
                <th className="text-right py-2">Pending</th>
              </tr>
            </thead>
            <tbody>
              {userSummaries.map((u) => {
                const net = u.totalPayout - u.totalStaked
                return (
                  <tr key={u.name} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="py-2 pr-4 font-medium text-white">{u.name}</td>
                    <td className="py-2 pr-4 text-right text-gray-300">₹{u.totalStaked.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-green-400">₹{u.totalPayout.toLocaleString()}</td>
                    <td className={`py-2 pr-4 text-right font-semibold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {net >= 0 ? '+' : ''}₹{net.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right text-green-400">{u.won}</td>
                    <td className="py-2 pr-4 text-right text-red-400">{u.lost}</td>
                    <td className="py-2 text-right text-yellow-400">{u.pending}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full bet log */}
      <div>
        <h2 className="text-lg font-semibold mb-3">All Bets (newest first)</h2>
        <div className="space-y-1">
          {(bets ?? []).length === 0 && (
            <p className="text-gray-500 text-sm">No bets placed yet.</p>
          )}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(bets ?? []).map((bet: any) => (
            <div
              key={bet.id}
              className="flex flex-wrap items-center justify-between gap-2 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {bet.profiles?.display_name ?? '—'}
                  </span>
                  <span className="text-xs text-gray-500">→</span>
                  <span className="text-xs text-gray-300">
                    {bet.markets?.matches?.team_a} vs {bet.markets?.matches?.team_b}
                  </span>
                  <span className="text-xs text-gray-500">·</span>
                  <span className="text-xs text-gray-400 capitalize">
                    {bet.markets?.market_type?.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-gray-500">·</span>
                  <span className="text-xs font-medium text-blue-300">{bet.bet_options?.label}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">
                  {format(new Date(bet.placed_at), 'dd MMM yyyy, h:mm a')}
                  {bet.settled_at && ` · settled ${format(new Date(bet.settled_at), 'dd MMM, h:mm a')}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-white">
                  ₹{Number(bet.amount).toLocaleString()}
                  <span className="text-xs text-gray-500 ml-1">@ {Number(bet.odds_at_placement).toFixed(2)}x</span>
                </p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[bet.status] ?? 'text-gray-400'}`}>
                  {bet.status === 'won'
                    ? `+₹${Number(bet.payout).toLocaleString()}`
                    : bet.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

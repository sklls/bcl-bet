import { createAdminClient } from '@/lib/supabase-server'
import Link from 'next/link'

export default async function AdminPage() {
  const admin = createAdminClient()

  const [
    { count: matchCount },
    { count: userCount },
    { count: betCount },
    { data: openMarkets },
    { data: houseStats },
    { data: topupStats },
  ] = await Promise.all([
    admin.from('matches').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
    admin.from('bets').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('markets').select('id').eq('status', 'open'),
    // Settled bets: total staked vs total paid out
    admin
      .from('bets')
      .select('amount, payout, status')
      .in('status', ['won', 'lost']),
    // Total credited via topup (cash collected)
    admin
      .from('transactions')
      .select('amount')
      .eq('type', 'topup')
      .gt('amount', 0),
  ])

  // House edge = total staked by losing bets − total paid out above stake on winning bets
  const totalStaked = (houseStats ?? []).reduce((s, b) => s + Number(b.amount), 0)
  const totalPaidOut = (houseStats ?? []).reduce((s, b) => s + Number(b.payout ?? 0), 0)
  const houseEdge = totalStaked - totalPaidOut
  const houseEdgePct = totalStaked > 0 ? ((houseEdge / totalStaked) * 100).toFixed(1) : '0.0'

  // Total cash topped up (real money collected)
  const totalCashIn = (topupStats ?? []).reduce((s, t) => s + Number(t.amount), 0)

  const stats = [
    { label: 'Total Matches', value: matchCount ?? 0, color: 'text-white' },
    { label: 'Registered Users', value: userCount ?? 0, color: 'text-white' },
    { label: 'Pending Bets', value: betCount ?? 0, color: 'text-yellow-400' },
    { label: 'Open Markets', value: openMarkets?.length ?? 0, color: 'text-green-400' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <p className="text-gray-400 text-sm mt-1">Manage matches, markets, and users</p>
      </div>

      {/* Core Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* House Edge / Financials */}
      <div>
        <h2 className="text-lg font-semibold mb-3">💰 Financial Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Cash Collected</p>
            <p className="text-xl font-bold text-blue-400">₹{totalCashIn.toLocaleString()}</p>
            <p className="text-xs text-gray-600 mt-1">via top-ups</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Staked</p>
            <p className="text-xl font-bold text-white">₹{totalStaked.toLocaleString()}</p>
            <p className="text-xs text-gray-600 mt-1">settled bets only</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Paid Out</p>
            <p className="text-xl font-bold text-green-400">₹{totalPaidOut.toLocaleString()}</p>
            <p className="text-xs text-gray-600 mt-1">to winners</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">House Edge Kept</p>
            <p className="text-xl font-bold text-yellow-400">₹{houseEdge.toLocaleString()}</p>
            <p className="text-xs text-gray-600 mt-1">{houseEdgePct}% of staked</p>
          </div>
        </div>

        {/* Visual bar */}
        {totalStaked > 0 && (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span>Payout Rate</span>
              <span>{(100 - parseFloat(houseEdgePct)).toFixed(1)}% paid out · {houseEdgePct}% kept</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 bg-green-500 rounded-full"
                style={{ width: `${Math.max(0, 100 - parseFloat(houseEdgePct))}%` }}
              />
            </div>
            <div className="flex justify-between text-xs mt-2">
              <span className="text-green-400">₹{totalPaidOut.toLocaleString()} paid out</span>
              <span className="text-yellow-400">₹{houseEdge.toLocaleString()} house edge</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/matches" className="block bg-gray-900 border border-gray-800 hover:border-green-500/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">Matches & Markets</h2>
          <p className="text-gray-400 text-sm">Create matches, open/close betting markets, declare results</p>
        </Link>
        <Link href="/admin/users" className="block bg-gray-900 border border-gray-800 hover:border-blue-500/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">User Wallets</h2>
          <p className="text-gray-400 text-sm">Top up user balances after cash collection</p>
        </Link>
      </div>
    </div>
  )
}

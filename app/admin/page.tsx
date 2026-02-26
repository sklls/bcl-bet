import { createAdminClient } from '@/lib/supabase-server'
import Link from 'next/link'
import FinancialOverview from '@/components/admin/FinancialOverview'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const admin = createAdminClient()

  const [
    { count: matchCount },
    { count: userCount },
    { count: betCount },
    { data: openMarkets },
    { data: financials },
  ] = await Promise.all([
    admin.from('matches').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
    admin.from('bets').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('markets').select('id').eq('status', 'open'),
    // Single RPC call — sums everything in Postgres, no JS row limits
    admin.rpc('get_financial_overview'),
  ])

  const f = financials as { total_cash_collected: number; total_staked: number; total_paid_out: number } | null
  const totalCashIn  = Number(f?.total_cash_collected ?? 0)
  const totalStaked  = Number(f?.total_staked ?? 0)
  const totalPaidOut = Number(f?.total_paid_out ?? 0)
  const houseEdge    = totalStaked - totalPaidOut
  const houseEdgePct = totalStaked > 0 ? ((houseEdge / totalStaked) * 100).toFixed(1) : '0.0'

  const stats = [
    { label: 'Total Matches',    value: matchCount ?? 0,          color: 'text-white' },
    { label: 'Registered Users', value: userCount ?? 0,           color: 'text-white' },
    { label: 'Pending Bets',     value: betCount ?? 0,            color: 'text-yellow-400' },
    { label: 'Open Markets',     value: openMarkets?.length ?? 0, color: 'text-green-400' },
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

      {/* Financial Overview — client component (has reset buttons) */}
      <FinancialOverview
        totalCashIn={totalCashIn}
        totalStaked={totalStaked}
        totalPaidOut={totalPaidOut}
        houseEdge={houseEdge}
        houseEdgePct={houseEdgePct}
      />

      {/* Navigation */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/matches" className="block bg-gray-900 border border-gray-800 hover:border-green-500/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">Matches & Markets</h2>
          <p className="text-gray-400 text-sm">Create matches, open/close betting markets, declare results</p>
        </Link>
        <Link href="/admin/users" className="block bg-gray-900 border border-gray-800 hover:border-blue-500/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">User Wallets</h2>
          <p className="text-gray-400 text-sm">Top up user balances after cash collection</p>
        </Link>
        <Link href="/admin/ledger" className="block bg-gray-900 border border-gray-800 hover:border-yellow-500/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">📒 Ledger</h2>
          <p className="text-gray-400 text-sm">View all bets by all users, per-user P&L summary</p>
        </Link>
      </div>
    </div>
  )
}

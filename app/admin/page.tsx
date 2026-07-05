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
    { data: topups },
    { data: settledBets },
    { data: winTransactions },
  ] = await Promise.all([
    admin.from('matches').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
    admin.from('bets').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('markets').select('id').eq('status', 'open'),
    admin.from('transactions').select('amount').eq('type', 'topup').limit(10000),
    admin.from('bets').select('amount').in('status', ['won', 'lost']).limit(10000),
    admin.from('transactions').select('amount').eq('type', 'win').limit(10000),
  ])

  const totalCashIn  = (topups ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const totalStaked  = (settledBets ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const totalPaidOut = (winTransactions ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const houseEdge    = totalStaked - totalPaidOut
  const houseEdgePct = totalStaked > 0 ? ((houseEdge / totalStaked) * 100).toFixed(1) : '0.0'

  const stats = [
    { label: 'Total Matches',    value: matchCount ?? 0,          color: 'text-white' },
    { label: 'Registered Users', value: userCount ?? 0,           color: 'text-white' },
    { label: 'Pending Bets',     value: betCount ?? 0,            color: 'text-yellow-400' },
    { label: 'Open Markets',     value: openMarkets?.length ?? 0, color: 'text-[#F07820]' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <p className="text-[#7a91c4] text-sm mt-1">Manage matches, markets, and users</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[#162244] border border-[#243568] rounded-xl p-4">
            <p className="text-xs text-[#5a7099] mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <FinancialOverview
        totalCashIn={totalCashIn}
        totalStaked={totalStaked}
        totalPaidOut={totalPaidOut}
        houseEdge={houseEdge}
        houseEdgePct={houseEdgePct}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/matches" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">Matches &amp; Markets</h2>
          <p className="text-[#7a91c4] text-sm">Create matches, open/close betting markets, declare results</p>
        </Link>
        <Link href="/admin/users" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">User Wallets</h2>
          <p className="text-[#7a91c4] text-sm">Top up user balances after cash collection</p>
        </Link>
        <Link href="/admin/ledger" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-1">📒 Ledger</h2>
          <p className="text-[#7a91c4] text-sm">View all bets by all users, per-user P&L summary</p>
        </Link>
      </div>
    </div>
  )
}

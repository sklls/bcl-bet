import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import Link from 'next/link'

export default async function AdminPage() {
  const admin = createAdminClient()

  const [{ count: matchCount }, { count: userCount }, { count: betCount }, { data: openMarkets }] =
    await Promise.all([
      admin.from('matches').select('*', { count: 'exact', head: true }),
      admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
      admin.from('bets').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('markets').select('id').eq('status', 'open'),
    ])

  const stats = [
    { label: 'Total Matches', value: matchCount ?? 0 },
    { label: 'Registered Users', value: userCount ?? 0 },
    { label: 'Pending Bets', value: betCount ?? 0 },
    { label: 'Open Markets', value: openMarkets?.length ?? 0 },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <p className="text-gray-400 text-sm mt-1">Manage matches, markets, and users</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

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

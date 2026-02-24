import { createServerSupabaseClient } from '@/lib/supabase-server'

export default async function LeaderboardPage() {
  const supabase = createServerSupabaseClient()

  const { data: players } = await supabase
    .from('leaderboard')
    .select('*')
    .limit(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-gray-400 text-sm mt-1">Ranked by total winnings</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
              <th className="text-left px-4 py-3">Rank</th>
              <th className="text-left px-4 py-3">Player</th>
              <th className="text-right px-4 py-3">Winnings</th>
              <th className="text-right px-4 py-3">W/L</th>
              <th className="text-right px-4 py-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(players ?? []).map((p: {
              id: string
              display_name: string
              total_winnings: number
              bets_won: number
              total_bets: number
              wallet_balance: number
            }, idx: number) => (
              <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3">
                  <span className={`font-bold ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-gray-500'}`}>
                    #{idx + 1}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-white">{p.display_name}</td>
                <td className="px-4 py-3 text-right text-green-400 font-semibold">
                  ₹{Number(p.total_winnings).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-gray-400">
                  {p.bets_won}/{p.total_bets}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  ₹{Number(p.wallet_balance).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(players ?? []).length === 0 && (
          <p className="text-center text-gray-500 py-10">No bets placed yet.</p>
        )}
      </div>
    </div>
  )
}

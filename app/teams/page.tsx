import { createServerSupabaseClient } from '@/lib/supabase-server'

interface TeamPlayer {
  id: string
  name: string
  role: string
  bid_amount: number
  batch: number
}

interface Team {
  id: string
  name: string
  category: string
  team_players: TeamPlayer[]
}

const roleOrder = ['Captain', 'Marquee', 'Intermediate', 'Novice']
const roleColors: Record<string, string> = {
  Captain: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  Marquee: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  Intermediate: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  Novice: 'bg-gray-500/20 text-gray-300 border border-gray-500/30',
}

export default async function TeamsPage() {
  const supabase = createServerSupabaseClient()

  const { data: teams } = await supabase
    .from('teams')
    .select('*, team_players(*)')
    .order('name')

  const mensTeams = (teams as Team[])?.filter(t => t.category === 'mens') ?? []
  const womensTeams = (teams as Team[])?.filter(t => t.category === 'womens') ?? []

  const sortPlayers = (players: TeamPlayer[]) =>
    [...players].sort(
      (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role)
    )

  return (
    <div className="min-h-screen bg-gray-950 text-white py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-center">BPL 2026 Teams</h1>
        <p className="text-gray-400 text-center mb-10">All squads from the auction</p>

        {/* Men's Teams */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-2xl">🏏</span>
            <h2 className="text-2xl font-bold text-blue-400">Men&apos;s Teams</h2>
            <span className="text-gray-500 text-sm ml-auto">{mensTeams.length} teams</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {mensTeams.map(team => (
              <TeamCard key={team.id} team={team} sortPlayers={sortPlayers} />
            ))}
          </div>
        </section>

        {/* Women's Teams */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-2xl">🏏</span>
            <h2 className="text-2xl font-bold text-pink-400">Women&apos;s Teams</h2>
            <span className="text-gray-500 text-sm ml-auto">{womensTeams.length} teams</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {womensTeams.map(team => (
              <TeamCard key={team.id} team={team} sortPlayers={sortPlayers} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function TeamCard({
  team,
  sortPlayers,
}: {
  team: Team
  sortPlayers: (p: TeamPlayer[]) => TeamPlayer[]
}) {
  const sorted = sortPlayers(team.team_players ?? [])
  const captain = sorted.find(p => p.role === 'Captain')
  const totalBid = sorted.reduce((s, p) => s + (p.bid_amount ?? 0), 0)

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-600 transition-colors">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-5 py-4 border-b border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{team.name}</h3>
            {captain && (
              <p className="text-xs text-yellow-400 mt-0.5">
                ⭐ {captain.name}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Squad</div>
            <div className="text-lg font-bold text-white">{sorted.length}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs text-gray-400">
          <span>💰 Total bid: <span className="text-white font-semibold">{totalBid}L</span></span>
        </div>
      </div>

      {/* Players */}
      <div className="divide-y divide-gray-800/50">
        {sorted.map((player, i) => (
          <div key={player.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/30">
            <span className="text-xs text-gray-600 w-5 text-right">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{player.name}</p>
              {player.batch && (
                <p className="text-xs text-gray-500">Batch &apos;{player.batch}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {player.bid_amount > 0 && (
                <span className="text-xs text-gray-400 font-mono">{player.bid_amount}L</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[player.role] ?? roleColors.Novice}`}>
                {player.role === 'Intermediate' ? 'Inter' : player.role}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

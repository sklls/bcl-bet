import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'

type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  venue: string | null
  status: string
  live_score_a: string | null
  live_score_b: string | null
  markets: { id: string; market_type: string; status: string }[]
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    live: 'bg-red-500 animate-pulse',
    upcoming: 'bg-blue-600',
    completed: 'bg-gray-600',
    cancelled: 'bg-yellow-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${colors[status] ?? 'bg-gray-600'}`}>
      {status.toUpperCase()}
    </span>
  )
}

function MatchCard({ match }: { match: Match }) {
  const openMarkets = match.markets?.filter((m) => m.status === 'open').length ?? 0

  return (
    <Link href={`/matches/${match.id}`}>
      <div className="bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-green-500/50 rounded-xl p-5 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <StatusBadge status={match.status} />
          <span className="text-xs text-gray-500">
            {format(new Date(match.match_date), 'dd MMM, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_a}</p>
            {match.live_score_a && (
              <p className="text-green-400 font-mono text-sm">{match.live_score_a}</p>
            )}
          </div>

          <div className="text-gray-500 font-bold text-sm px-4">VS</div>

          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_b}</p>
            {match.live_score_b && (
              <p className="text-green-400 font-mono text-sm">{match.live_score_b}</p>
            )}
          </div>
        </div>

        {match.venue && (
          <p className="text-xs text-gray-500 text-center mt-2">{match.venue}</p>
        )}

        <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {openMarkets > 0 ? (
              <span className="text-green-400">{openMarkets} market{openMarkets > 1 ? 's' : ''} open</span>
            ) : (
              'No open markets'
            )}
          </span>
          <span className="text-xs text-green-500 font-medium">View →</span>
        </div>
      </div>
    </Link>
  )
}

export default async function HomePage() {
  const supabase = createServerSupabaseClient()
  const { data: matches } = await supabase
    .from('matches')
    .select('*, markets(id, market_type, status)')
    .order('match_date', { ascending: true })

  const live = (matches ?? []).filter((m: Match) => m.status === 'live')
  const upcoming = (matches ?? []).filter((m: Match) => m.status === 'upcoming')
  const completed = (matches ?? []).filter((m: Match) => m.status === 'completed')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">BCL Tournament</h1>
        <p className="text-gray-400 text-sm mt-1">Place your bets on match outcomes</p>
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-red-400 mb-3">Live Now</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {live.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-blue-400 mb-3">Upcoming</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-500 mb-3">Completed</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {completed.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {(matches ?? []).length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-4xl mb-3">🏏</p>
          <p>No matches scheduled yet. Check back soon!</p>
        </div>
      )}
    </div>
  )
}

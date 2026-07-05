import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

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
    live: 'bg-[#C41E28] animate-pulse',
    upcoming: 'bg-[#1B3A8A]',
    completed: 'bg-[#243568] text-[#7a91c4]',
    cancelled: 'bg-yellow-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${colors[status] ?? 'bg-[#243568]'}`}>
      {status.toUpperCase()}
    </span>
  )
}

function MatchCard({ match }: { match: Match }) {
  const openMarkets = match.markets?.filter((m) => m.status === 'open').length ?? 0

  return (
    <Link href={`/matches/${match.id}`}>
      <div className="bg-[#162244] hover:bg-[#1E2E52] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-5 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <StatusBadge status={match.status} />
          <span className="text-xs text-[#5a7099]">
            {format(new Date(match.match_date), 'dd MMM, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_a}</p>
            {match.live_score_a && (
              <p className="text-[#F07820] font-mono text-sm">{match.live_score_a}</p>
            )}
          </div>

          <div className="text-[#5a7099] font-bold text-sm px-4">VS</div>

          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_b}</p>
            {match.live_score_b && (
              <p className="text-[#F07820] font-mono text-sm">{match.live_score_b}</p>
            )}
          </div>
        </div>

        {match.venue && (
          <p className="text-xs text-[#5a7099] text-center mt-2">{match.venue}</p>
        )}

        <div className="mt-3 pt-3 border-t border-[#243568] flex items-center justify-between">
          <span className="text-xs text-[#7a91c4]">
            {openMarkets > 0 ? (
              <span className="text-[#F07820]">{openMarkets} market{openMarkets > 1 ? 's' : ''} open</span>
            ) : (
              'No open markets'
            )}
          </span>
          <span className="text-xs text-[#F07820] font-medium">View →</span>
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

  const now = new Date()
  const live = (matches ?? []).filter((m: Match) => m.status === 'live')
  const upcoming = (matches ?? []).filter((m: Match) => m.status === 'upcoming' && new Date(m.match_date) > now)
  const completed = (matches ?? [])
    .filter((m: Match) => m.status === 'completed' || (m.status === 'upcoming' && new Date(m.match_date) <= now))
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">BPL Tournament</h1>
        <p className="text-[#7a91c4] text-sm mt-1">Place your bets on match outcomes</p>
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#C41E28] mb-3">Live Now</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {live.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#F07820] mb-3">Upcoming</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#5a7099] mb-3">Completed</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {completed.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {(matches ?? []).length === 0 && (
        <div className="text-center py-20 text-[#5a7099]">
          <p className="text-4xl mb-3">🏏</p>
          <p>No matches scheduled yet. Check back soon!</p>
        </div>
      )}
    </div>
  )
}

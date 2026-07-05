import { createServerSupabaseClient } from '@/lib/supabase-server'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import MarketsSection from '@/components/betting/MarketsSection'
import LiveScoreCard from '@/components/betting/LiveScoreCard'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient()

  const [{ data: match }, { data: { user } }] = await Promise.all([
    supabase
      .from('matches')
      .select('*, markets(*, bet_options(*))')
      .eq('id', params.id)
      .single(),
    supabase.auth.getUser(),
  ])

  if (!match) notFound()

  let userBalance: number | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single()
    userBalance = profile?.wallet_balance ?? null
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#162244] border border-[#243568] rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            match.status === 'live' ? 'bg-[#C41E28] text-white animate-pulse' :
            match.status === 'upcoming' ? 'bg-[#1B3A8A] text-white' :
            'bg-[#243568] text-[#7a91c4]'
          }`}>
            {match.status.toUpperCase()}
          </span>
          <span className="text-xs text-[#5a7099]">
            {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-around mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_a}</p>
            {match.live_score_a && (
              <p className="text-[#F07820] font-mono mt-1">{match.live_score_a} ({match.live_overs_a} Ov)</p>
            )}
          </div>
          <div className="text-[#5a7099] font-bold">VS</div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_b}</p>
            {match.live_score_b && (
              <p className="text-[#F07820] font-mono mt-1">{match.live_score_b} ({match.live_overs_b} Ov)</p>
            )}
          </div>
        </div>

        {match.venue && (
          <p className="text-center text-[#5a7099] text-sm mt-3">{match.venue}</p>
        )}

        {match.over_under_line && (
          <p className="text-center text-[#7a91c4] text-sm mt-1">
            Over/Under line: <span className="text-yellow-400 font-semibold">{match.over_under_line} runs</span>
          </p>
        )}

        {match.cricheroes_match_id && (
          <div className="text-center mt-3">
            <a
              href={`https://cricheroes.com/scorecard/${match.cricheroes_match_id}/${match.cricheroes_slug ?? ''}/summary`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#7a91c4] hover:text-[#F07820] transition-colors"
            >
              View full scorecard on CricHeroes →
            </a>
          </div>
        )}
      </div>

      {match.status === 'live' && match.cricheroes_match_id && (
        <LiveScoreCard
          matchId={match.id}
          initialScoreA={match.live_score_a}
          initialScoreB={match.live_score_b}
          teamA={match.team_a}
          teamB={match.team_b}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Betting Markets</h2>

        {!user && (
          <div className="bg-[#F07820]/10 border border-[#F07820]/30 rounded-lg p-4 mb-4 text-sm text-[#F07820]">
            <a href="/login" className="underline">Sign in</a> to place bets.
          </div>
        )}

        {user && userBalance !== null && (
          <div className="bg-[#162244] border border-[#243568] rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <span className="text-sm text-[#7a91c4]">Your balance</span>
            <span className="font-bold text-[#F07820]">₹{userBalance.toLocaleString()}</span>
          </div>
        )}

        <MarketsSection
          initialMarkets={match.markets ?? []}
          matchId={match.id}
          userBalance={userBalance}
        />
      </div>
    </div>
  )
}

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import Link from 'next/link'
import MarketsSection from '@/components/betting/MarketsSection'
import { SPORTS, SportType } from '@/lib/sports'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: { sport: string; matchId: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()

  const supabase = createServerSupabaseClient()
  const [{ data: match }, { data: { user } }] = await Promise.all([
    supabase
      .from('matches')
      .select('*, markets(*, bet_options(*))')
      .eq('id', params.matchId)
      .eq('sport', sport)
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
      <Link href={`/sports/${sport}`} className="text-sm text-[#7a91c4] hover:text-white transition-colors">
        ← {SPORTS[sport].emoji} {SPORTS[sport].label}
      </Link>

      <div className="bg-[#162244] border border-[#243568] rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            match.status === 'live'     ? 'bg-[#C41E28] text-white animate-pulse' :
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
          </div>
          <div className="text-[#5a7099] font-bold">VS</div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_b}</p>
          </div>
        </div>

        {match.venue && (
          <p className="text-center text-[#5a7099] text-sm mt-3">{match.venue}</p>
        )}
      </div>

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

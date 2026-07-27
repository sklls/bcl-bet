import { createServerSupabaseClient } from '@/lib/supabase-server'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import Link from 'next/link'
import MarketsSection from '@/components/betting/MarketsSection'
import { SPORTS, SportType } from '@/lib/sports'
import { formatCredits } from '@/lib/credits'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: { sport: string; matchId: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()

  const supabase = createServerSupabaseClient()
  const [{ data: match }, { data: { user } }] = await Promise.all([
    supabase
      .from('matches')
      .select('*, markets(*, bet_options(id, label, total_amount_bet, seed_amount))')
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
      <Link href={`/sports/${sport}`} className="text-sm text-slate hover:text-white transition-colors">
        ← {SPORTS[sport].emoji} {SPORTS[sport].label}
      </Link>

      <div className="bg-table border border-rail rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            match.status === 'live'     ? 'bg-crimson text-white animate-pulse' :
            match.status === 'upcoming' ? 'bg-royal text-white' :
                                          'bg-rail text-slate'
          }`}>
            {match.status.toUpperCase()}
          </span>
          <span className="text-xs text-slate">
            {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-around mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_a}</p>
          </div>
          <div className="text-slate font-bold">VS</div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_b}</p>
          </div>
        </div>

        {match.venue && (
          <p className="text-center text-slate text-sm mt-3">{match.venue}</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Betting Markets</h2>

        {!user && (
          <div className="bg-amber/10 border border-amber/30 rounded-lg p-4 mb-4 text-sm text-amber">
            <a href="/login" className="underline">Sign in</a> to place bets.
          </div>
        )}

        {user && userBalance !== null && (
          <div className="bg-table border border-rail rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <span className="text-sm text-slate">Your balance</span>
            <span className="font-bold text-amber">{formatCredits(userBalance)}</span>
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

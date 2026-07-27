import Link from 'next/link'
import { format } from 'date-fns'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { SPORTS, SportType, hasFantasy } from '@/lib/sports'
import { resolveSquad } from '@/lib/fantasy/squad'
import TeamBuilder from '@/components/fantasy/TeamBuilder'
import ContestLeaderboard from '@/components/fantasy/ContestLeaderboard'
import DataError from '@/components/ui/DataError'
import { formatCredits } from '@/lib/credits'

export const dynamic = 'force-dynamic'

export default async function ContestPage({
  params,
}: {
  params: { sport: string; matchId: string }
}) {
  const sport = params.sport as SportType
  if (!SPORTS[sport] || !hasFantasy(sport)) notFound()

  const admin = createAdminClient()
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: match, error: matchErr } = await admin
    .from('matches')
    .select('id, sport, team_a, team_b, match_date, venue')
    .eq('id', params.matchId)
    .single()

  // A failed read is not a missing fixture. PGRST116 is "no rows", which is a
  // genuine 404; anything else is our problem and must not masquerade as one.
  if (matchErr && matchErr.code !== 'PGRST116') {
    console.error('[fantasy/contest] match query failed:', matchErr)
    return <div className="space-y-6"><DataError what="this fixture" /></div>
  }
  if (!match || match.sport !== sport) notFound()

  const header = (
    <div className="flex items-center gap-3">
      <Link href={`/sports/${sport}/fantasy`} className="text-slate hover:text-white text-sm transition-colors">
        ← Contests
      </Link>
      <span className="text-rail">/</span>
      <h1 className="text-xl font-bold text-white">
        {match.team_a} <span className="text-slate font-normal">vs</span> {match.team_b}
      </h1>
    </div>
  )

  const { data: contest, error: contestErr } = await admin
    .from('contests')
    .select('id, entry_fee, status, prize_pool, locks_at')
    .eq('match_id', params.matchId)
    .maybeSingle()

  if (contestErr) {
    console.error('[fantasy/contest] contest query failed:', contestErr)
    return <div className="space-y-6">{header}<DataError what="this contest" /></div>
  }

  if (!contest) {
    return (
      <div className="space-y-6">
        {header}
        <div className="text-center py-20 text-slate">
          <p className="text-4xl mb-3">🏆</p>
          <p>No contest for this match yet.</p>
        </div>
      </div>
    )
  }

  const locked = contest.status !== 'open' || new Date(contest.locks_at) <= new Date()

  if (locked) {
    return (
      <div className="space-y-6">
        {header}
        <ContestLeaderboard contestId={contest.id} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <div className="bg-table border border-rail rounded-xl p-6 text-center space-y-3">
          <p className="text-sm text-slate">Sign in to pick your XI.</p>
          <Link href="/login" className="inline-block px-4 py-2 rounded-lg bg-amber hover:bg-amber-deep text-white text-sm font-semibold">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  const squad = await resolveSquad(admin, params.matchId)
  if (!squad.ok) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-crimson-light">{squad.error}</p>
      </div>
    )
  }

  const { data: profile } = await admin
    .from('profiles').select('wallet_balance').eq('id', user.id).single()

  const { data: entry, error: entryErr } = await admin
    .from('contest_entries')
    .select('id, captain_id, vice_captain_id, entry_players(player_id)')
    .eq('contest_id', contest.id)
    .eq('user_id', user.id)
    .maybeSingle()

  // The most damaging one to swallow: a failed lookup would render an empty
  // builder to someone who has already entered, as though their XI were gone.
  // Re-submitting would not double-charge, but it would silently replace a
  // lineup they had already settled on.
  if (entryErr) {
    console.error('[fantasy/contest] entry query failed:', entryErr)
    return <div className="space-y-6">{header}<DataError what="your entry" /></div>
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate">
        <span>Locks {format(new Date(contest.locks_at), 'dd MMM, h:mm a')}</span>
        <span className="text-rail">•</span>
        <span>Pool {`${formatCredits(Number(contest.prize_pool))}`}</span>
        {match.venue && <><span className="text-rail">•</span><span>{match.venue}</span></>}
      </div>

      <TeamBuilder
        contestId={contest.id}
        entryFee={Number(contest.entry_fee)}
        sport={squad.payload.sport}
        teams={squad.payload.teams}
        players={squad.payload.players}
        balance={profile ? Number(profile.wallet_balance) : null}
        existingEntry={entry ? {
          id: entry.id,
          player_ids: (entry.entry_players ?? []).map((p: { player_id: string }) => p.player_id),
          captain_id: entry.captain_id,
          vice_captain_id: entry.vice_captain_id,
        } : null}
      />
    </div>
  )
}

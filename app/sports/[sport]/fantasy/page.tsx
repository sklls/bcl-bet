import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import { notFound } from 'next/navigation'
import { SPORTS, SportType, hasFantasy } from '@/lib/sports'

export const dynamic = 'force-dynamic'

type ContestRow = {
  id: string
  match_id: string
  entry_fee: string
  prize_pool: string
  status: string
  locks_at: string
  entrants: number
  match: { team_a: string; team_b: string; match_date: string; venue: string | null }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

function ContestCard({ sport, contest }: { sport: string; contest: ContestRow }) {
  const locksAt = new Date(contest.locks_at)
  const isOpen = contest.status === 'open' && locksAt > new Date()

  return (
    <Link href={`/sports/${sport}/fantasy/${contest.match_id}`}>
      <div className="bg-table hover:bg-raised border border-rail hover:border-amber/50 rounded-xl p-5 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium text-white ${
            isOpen ? 'bg-royal' : contest.status === 'settled' ? 'bg-rail text-slate'
            : contest.status === 'void' ? 'bg-gold' : 'bg-crimson'
          }`}>
            {isOpen ? 'OPEN' : contest.status.toUpperCase()}
          </span>
          <span className="text-xs text-slate">
            {isOpen ? `Locks ${format(locksAt, 'dd MMM, h:mm a')}` : format(locksAt, 'dd MMM, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{contest.match.team_a}</p>
          </div>
          <div className="text-slate font-bold text-sm px-4">VS</div>
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{contest.match.team_b}</p>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-rail grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-slate">Entry</p>
            <p className="text-sm font-semibold text-white">{inr(Number(contest.entry_fee))}</p>
          </div>
          <div>
            <p className="text-xs text-slate">Entrants</p>
            <p className="text-sm font-semibold text-white">{contest.entrants}</p>
          </div>
          <div>
            <p className="text-xs text-slate">Prize pool</p>
            <p className="text-sm font-semibold text-gold">{inr(Number(contest.prize_pool))}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}

function Section({ title, tone, contests, sport }: {
  title: string; tone: string; contests: ContestRow[]; sport: string
}) {
  if (contests.length === 0) return null
  return (
    <section>
      <h2 className={`text-lg font-semibold mb-3 ${tone}`}>{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {contests.map(c => <ContestCard key={c.id} sport={sport} contest={c} />)}
      </div>
    </section>
  )
}

export default async function FantasyContestsPage({ params }: { params: { sport: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()
  if (!hasFantasy(sport)) notFound()

  // Entrant counts are an aggregate over contest_entries, which RLS keeps
  // private per user — read them with the admin client. No lineup is exposed.
  const admin = createAdminClient()
  const { data } = await admin
    .from('contests')
    .select('id, match_id, entry_fee, prize_pool, status, locks_at, matches!inner(sport, team_a, team_b, match_date, venue), contest_entries(count)')
    .eq('matches.sport', sport)
    .order('locks_at', { ascending: true })

  const contests: ContestRow[] = (data ?? []).map(c => {
    const m = c.matches as unknown as { team_a: string; team_b: string; match_date: string; venue: string | null }
    const counts = c.contest_entries as unknown as { count: number }[]
    return {
      id: c.id,
      match_id: c.match_id,
      entry_fee: c.entry_fee,
      prize_pool: c.prize_pool,
      status: c.status,
      locks_at: c.locks_at,
      entrants: counts?.[0]?.count ?? 0,
      match: m,
    }
  })

  const now = new Date()
  const open      = contests.filter(c => c.status === 'open' && new Date(c.locks_at) > now)
  const inPlay    = contests.filter(c => (c.status === 'open' && new Date(c.locks_at) <= now) || c.status === 'locked')
  const completed = contests
    .filter(c => c.status === 'settled' || c.status === 'void')
    .sort((a, b) => new Date(b.locks_at).getTime() - new Date(a.locks_at).getTime())

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href={`/sports/${sport}`} className="text-slate hover:text-white text-sm transition-colors">
          ← {SPORTS[sport].label}
        </Link>
        <span className="text-rail">/</span>
        <h1 className="text-2xl font-bold text-white">🏆 Fantasy</h1>
      </div>

      <Section title="Open for entry" tone="text-amber"        contests={open}      sport={sport} />
      <Section title="In play"        tone="text-crimson-light" contests={inPlay}    sport={sport} />
      <Section title="Completed"      tone="text-slate"         contests={completed} sport={sport} />

      {contests.length === 0 && (
        <div className="text-center py-20 text-slate">
          <p className="text-4xl mb-3">🏆</p>
          <p>No fantasy contests yet.</p>
        </div>
      )}
    </div>
  )
}

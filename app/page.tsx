import Link from 'next/link'
import { createPublicClient } from '@/lib/supabase-server'
import { SPORTS, ALL_SPORTS, SportType } from '@/lib/sports'
import SportIcon from '@/components/ui/SportIcon'

// Public match counts only — cache for 30s instead of rendering fresh every hit.
export const revalidate = 30

export default async function HomePage() {
  const supabase = createPublicClient()
  const { data: matches } = await supabase
    .from('matches')
    .select('sport, status')
    .in('status', ['live', 'upcoming'])

  const counts: Record<SportType, { live: number; upcoming: number }> = {
    cricket:      { live: 0, upcoming: 0 },
    football:     { live: 0, upcoming: 0 },
    table_tennis: { live: 0, upcoming: 0 },
    volleyball:   { live: 0, upcoming: 0 },
    pool:         { live: 0, upcoming: 0 },
    basketball:   { live: 0, upcoming: 0 },
  }

  ;(matches ?? []).forEach((m: { sport: SportType; status: string }) => {
    if (counts[m.sport]) {
      if (m.status === 'live') counts[m.sport].live++
      else counts[m.sport].upcoming++
    }
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">PrimeStake</h1>
        <p className="text-slate text-sm mt-1">Select a sport to view matches and place bets</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_SPORTS.map(sport => {
          const { live, upcoming } = counts[sport]
          return (
            <Link
              key={sport}
              href={`/sports/${sport}`}
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-baize"
            >
              <div className="flex h-full flex-col bg-table hover:bg-raised border border-rail group-hover:border-amber/50 group-focus-visible:border-amber rounded-xl p-6 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-raised text-slate transition-colors group-hover:text-ink">
                    <SportIcon sport={sport} className="h-7 w-7" />
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-amber transition-transform duration-200 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-ink">{SPORTS[sport].label}</h2>

                <div className="mt-1.5 min-h-[36px] space-y-0.5">
                  {live > 0 && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-crimson-light">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-crimson opacity-75 animate-ping motion-reduce:hidden" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-crimson-light" />
                      </span>
                      {live} match{live > 1 ? 'es' : ''} live now
                    </p>
                  )}
                  {upcoming > 0 && (
                    <p className="text-xs text-slate">{upcoming} upcoming</p>
                  )}
                  {live === 0 && upcoming === 0 && (
                    <p className="text-xs text-slate">No matches scheduled</p>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SPORTS, ALL_SPORTS, SportType } from '@/lib/sports'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = createServerSupabaseClient()
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
        <h1 className="text-2xl font-bold text-white">BCL Tournament</h1>
        <p className="text-[#7a91c4] text-sm mt-1">Select a sport to view matches and place bets</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_SPORTS.map(sport => {
          const { live, upcoming } = counts[sport]
          return (
            <Link key={sport} href={`/sports/${sport}`}>
              <div className="bg-[#162244] hover:bg-[#1E2E52] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-all cursor-pointer h-full">
                <div className="text-4xl mb-3">{SPORTS[sport].emoji}</div>
                <h2 className="text-lg font-bold text-white">{SPORTS[sport].label}</h2>
                <div className="mt-2 space-y-0.5 min-h-[36px]">
                  {live > 0 && (
                    <p className="text-xs text-[#C41E28] font-medium animate-pulse">
                      🔴 {live} match{live > 1 ? 'es' : ''} live now
                    </p>
                  )}
                  {upcoming > 0 && (
                    <p className="text-xs text-[#7a91c4]">{upcoming} upcoming</p>
                  )}
                  {live === 0 && upcoming === 0 && (
                    <p className="text-xs text-[#5a7099]">No matches scheduled</p>
                  )}
                </div>
                <p className="text-xs text-[#F07820] font-medium mt-4">View matches →</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

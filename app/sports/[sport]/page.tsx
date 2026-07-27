import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { notFound, redirect } from 'next/navigation'
import { SPORTS, SportType, hasFantasy } from '@/lib/sports'

export const dynamic = 'force-dynamic'

function ModeCard({
  href, emoji, title, subtitle, meta,
}: {
  href: string; emoji: string; title: string; subtitle: string; meta: string
}) {
  return (
    <Link href={href}>
      <div className="bg-table hover:bg-raised border border-rail hover:border-amber/50 rounded-xl p-6 sm:p-8 transition-all cursor-pointer h-full flex flex-col">
        <p className="text-4xl mb-3">{emoji}</p>
        <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
        <p className="text-sm text-slate flex-1">{subtitle}</p>
        <div className="mt-4 pt-4 border-t border-rail flex items-center justify-between">
          <span className="text-xs text-amber font-medium">{meta}</span>
          <span className="text-xs text-amber font-medium">Enter →</span>
        </div>
      </div>
    </Link>
  )
}

export default async function SportPage({ params }: { params: { sport: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()

  // The other four sports have nothing to choose between.
  if (!hasFantasy(sport)) redirect(`/sports/${sport}/betting`)

  const supabase = createServerSupabaseClient()

  const { data: matches } = await supabase
    .from('matches')
    .select('id, markets(status)')
    .eq('sport', sport)

  const matchIds = (matches ?? []).map(m => m.id)
  const openMarkets = (matches ?? []).reduce(
    (n, m) => n + ((m.markets ?? []) as { status: string }[]).filter(k => k.status === 'open').length, 0)

  let openContests = 0
  if (matchIds.length > 0) {
    const { count } = await supabase
      .from('contests')
      .select('*', { count: 'exact', head: true })
      .in('match_id', matchIds)
      .eq('status', 'open')
      .gt('locks_at', new Date().toISOString())
    openContests = count ?? 0
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-slate hover:text-white text-sm transition-colors">← Sports</Link>
        <span className="text-rail">/</span>
        <h1 className="text-2xl font-bold text-white">
          {SPORTS[sport].emoji} {SPORTS[sport].label}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          href={`/sports/${sport}/betting`}
          emoji="🎯"
          title="Betting"
          subtitle="Back an outcome. Winners share the pool."
          meta={openMarkets > 0
            ? `${openMarkets} market${openMarkets > 1 ? 's' : ''} open`
            : 'No open markets'}
        />
        <ModeCard
          href={`/sports/${sport}/fantasy`}
          emoji="🏆"
          title="Fantasy"
          subtitle="Pick 11. Score points. Top ranks win."
          meta={openContests > 0
            ? `${openContests} contest${openContests > 1 ? 's' : ''} open`
            : 'No contests open'}
        />
      </div>
    </div>
  )
}

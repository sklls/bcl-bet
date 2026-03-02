import { createAdminClient } from '@/lib/supabase-server'
import LeaderboardClient from './LeaderboardClient'

export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const supabase = createAdminClient()

  const [{ data: matches }, { data: overall }] = await Promise.all([
    supabase
      .from('matches')
      .select('id, team_a, team_b, match_date, status')
      .order('match_date', { ascending: false }),
    supabase
      .from('leaderboard')
      .select('*')
      .limit(50),
  ])

  return <LeaderboardClient matches={matches ?? []} overall={overall ?? []} />
}

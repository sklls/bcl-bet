import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('matches')
    .select('id, team_a, team_b, match_date, status')
    .order('match_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

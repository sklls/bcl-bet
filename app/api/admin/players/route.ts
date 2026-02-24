import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// GET /api/admin/players?teams=Titans,Daredevils
// Returns players for the given team names, grouped by team
export async function GET(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const teamsParam = searchParams.get('teams')
  if (!teamsParam) return NextResponse.json({ error: 'Missing teams param' }, { status: 400 })

  const teamNames = teamsParam.split(',').map(t => t.trim()).filter(Boolean)

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('teams')
    .select('name, team_players(name, role)')
    .in('name', teamNames)
    .eq('category', 'mens')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return as { teamName: playerName[] }
  const result: Record<string, string[]> = {}
  for (const team of data ?? []) {
    result[team.name] = (team.team_players ?? []).map((p: { name: string }) => p.name).sort()
  }

  return NextResponse.json(result)
}

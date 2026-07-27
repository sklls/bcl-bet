import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { resolveSquad } from '@/lib/fantasy/squad'
import { CREDIT_BUDGET, SQUAD_SIZE, MAX_PER_TEAM, FOOTBALL_QUOTAS } from '@/lib/fantasy/lineup'

// GET /api/fantasy/squad?matchId=<uuid>
// The selectable pool for a fixture, priced. Public — squads and credits are
// not secret, and the builder needs them before the user has an entry.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('matchId')
  if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 })

  const admin = createAdminClient()
  const result = await resolveSquad(admin, matchId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    ...result.payload,
    budget: CREDIT_BUDGET,
    squadSize: SQUAD_SIZE,
    maxPerTeam: MAX_PER_TEAM,
    quotas: result.payload.sport === 'football' ? FOOTBALL_QUOTAS : null,
  })
}

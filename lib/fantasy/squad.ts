// ── Server-side squad resolution ───────────────────────────
// Shared by /api/fantasy/squad (which serves it to the builder) and
// /api/fantasy/entry (which rebuilds it to validate a submission).
//
// The entry route must never trust a client-supplied pool: credits and team
// membership are what the budget and per-team cap are checked against, so a
// forged pool would forge the rules. Both callers go through here.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SelectablePlayer } from './lineup'
import type { FantasySport } from './scoring'

export interface SquadPayload {
  sport: FantasySport
  teams: { id: string; name: string }[]
  players: SelectablePlayer[]
}

export type SquadResult =
  | { ok: true; payload: SquadPayload; match: { id: string; team_a: string; team_b: string; match_date: string } }
  | { ok: false; status: number; error: string }

const FANTASY_SPORTS = ['cricket', 'football']

/**
 * Resolve both squads for a match, priced. Mirrors the team lookup in
 * app/api/admin/players/route.ts: teams are matched by NAME within the
 * match's sport, restricted to the 'mens' category.
 */
export async function resolveSquad(admin: SupabaseClient, matchId: string): Promise<SquadResult> {
  const { data: match, error: matchErr } = await admin
    .from('matches')
    .select('id, sport, team_a, team_b, match_date')
    .eq('id', matchId)
    .single()

  if (matchErr || !match) return { ok: false, status: 404, error: 'Match not found' }
  if (!FANTASY_SPORTS.includes(match.sport)) {
    return { ok: false, status: 400, error: `Fantasy is not available for ${match.sport}` }
  }

  const { data: teams, error: teamsErr } = await admin
    .from('teams')
    .select('id, name, team_players(id, name, role, credits)')
    .in('name', [match.team_a, match.team_b])
    .eq('sport', match.sport)
    .eq('category', 'mens')

  if (teamsErr) return { ok: false, status: 500, error: teamsErr.message }
  if (!teams || teams.length < 2) {
    return { ok: false, status: 404, error: 'Both squads for this fixture could not be found' }
  }

  const players: SelectablePlayer[] = []
  for (const team of teams) {
    for (const p of team.team_players ?? []) {
      players.push({
        id: p.id,
        name: p.name,
        role: p.role ?? '',
        credits: Number(p.credits),   // NUMERIC arrives as a string
        team_id: team.id,
      })
    }
  }

  // Dearest first — the expensive picks are the interesting decision.
  players.sort((a, b) => Number(b.credits) - Number(a.credits) || a.name.localeCompare(b.name))

  return {
    ok: true,
    match,
    payload: {
      sport: match.sport as FantasySport,
      teams: teams.map(t => ({ id: t.id, name: t.name })),
      players,
    },
  }
}

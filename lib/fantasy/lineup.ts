/**
 * Lineup rules. Pure, so the team builder and the server enforce exactly the
 * same constraints — the client copy is a convenience, the server copy is the
 * authority.
 *
 * Returns ALL violations rather than the first, so the builder can show a
 * complete checklist instead of making the user fix one thing at a time.
 */
import type { FantasySport } from './scoring'

export const SQUAD_SIZE = 11
export const CREDIT_BUDGET = 100
export const MAX_PER_TEAM = 7

/**
 * Football positions come from team_players.role, which holds GK/DEF/MID/FWD
 * for football squads. Cricket's roles are auction tiers (Captain, Marquee,
 * Intermediate, Novice) rather than playing positions, so cricket gets no
 * quotas — see the spec for why.
 */
export const FOOTBALL_QUOTAS: Record<string, { min: number; max: number }> = {
  GK:  { min: 1, max: 1 },
  DEF: { min: 3, max: 5 },
  MID: { min: 3, max: 5 },
  FWD: { min: 1, max: 3 },
}

export interface SelectablePlayer {
  id: string
  name: string
  role: string
  credits: number | string
  team_id: string
}

export interface LineupSelection {
  playerIds: string[]
  captainId: string
  viceCaptainId: string
}

export interface LineupError {
  code: string
  message: string
}

const num = (v: number | string) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Total credits a selection costs. Unknown ids contribute nothing. */
export function lineupCost(playerIds: string[], pool: SelectablePlayer[]): number {
  const byId = new Map(pool.map(p => [p.id, p]))
  const total = playerIds.reduce((sum, id) => {
    const p = byId.get(id)
    return sum + (p ? num(p.credits) : 0)
  }, 0)
  return Math.round(total * 100) / 100
}

export function validateLineup(
  selection: LineupSelection,
  pool: SelectablePlayer[],
  sport: FantasySport,
): LineupError[] {
  const errors: LineupError[] = []
  const { playerIds, captainId, viceCaptainId } = selection
  const byId = new Map(pool.map(p => [p.id, p]))

  // Plain arrays and records throughout rather than iterating Sets and Maps:
  // the app compiles at the default ES5 target, where for..of and spread over
  // those needs downlevelIteration.
  const unique = playerIds.filter((id, i) => playerIds.indexOf(id) === i)
  const has = (id: string) => unique.indexOf(id) !== -1

  if (unique.length !== playerIds.length) {
    errors.push({ code: 'DUPLICATE_PLAYER', message: 'The same player is picked more than once.' })
  }
  if (unique.length !== SQUAD_SIZE) {
    errors.push({ code: 'SQUAD_SIZE', message: `Pick exactly ${SQUAD_SIZE} players — you have ${unique.length}.` })
  }

  const unknown = unique.filter(id => !byId.has(id))
  if (unknown.length) {
    errors.push({ code: 'UNKNOWN_PLAYER', message: 'A pick is not in either squad for this match.' })
  }

  const cost = lineupCost(unique, pool)
  if (cost > CREDIT_BUDGET) {
    errors.push({ code: 'OVER_BUDGET', message: `Over budget: ${cost} of ${CREDIT_BUDGET} credits.` })
  }

  const perTeam: Record<string, number> = {}
  for (const id of unique) {
    const p = byId.get(id)
    if (!p) continue
    perTeam[p.team_id] = (perTeam[p.team_id] ?? 0) + 1
  }
  if (Object.keys(perTeam).some(t => perTeam[t] > MAX_PER_TEAM)) {
    errors.push({ code: 'MAX_PER_TEAM', message: `No more than ${MAX_PER_TEAM} players from one team.` })
  }

  if (!has(captainId)) {
    errors.push({ code: 'CAPTAIN_NOT_IN_SQUAD', message: 'The captain must be one of your 11.' })
  }
  if (!has(viceCaptainId)) {
    errors.push({ code: 'VICE_NOT_IN_SQUAD', message: 'The vice-captain must be one of your 11.' })
  }
  if (captainId && captainId === viceCaptainId) {
    errors.push({ code: 'CAPTAIN_IS_VICE', message: 'Captain and vice-captain must be different players.' })
  }

  if (sport === 'football') {
    const perRole: Record<string, number> = {}
    for (const id of unique) {
      const p = byId.get(id)
      if (!p) continue
      perRole[p.role] = (perRole[p.role] ?? 0) + 1
    }
    for (const [role, { min, max }] of Object.entries(FOOTBALL_QUOTAS)) {
      const have = perRole[role] ?? 0
      if (have < min || have > max) {
        errors.push({
          code: `QUOTA_${role}`,
          message: min === max
            ? `Pick exactly ${min} ${role} — you have ${have}.`
            : `Pick ${min}–${max} ${role} — you have ${have}.`,
        })
      }
    }
  }

  return errors
}

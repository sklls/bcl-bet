/**
 * Fantasy scoring. Pure and dependency-free so it runs identically in the
 * browser (to preview a lineup) and on the server (to settle a contest).
 *
 * Five capturable stats per sport, chosen so one scorer with a phone can
 * record a whole match live. Deliberately excluded: strike rate, economy and
 * minutes played — each needs a second input field to compute, roughly
 * doubling data entry for modest gain.
 */

export type FantasySport = 'cricket' | 'football'

export interface PlayerStats {
  player_id: string
  played: boolean
  // cricket
  runs?: number
  wickets?: number
  catches?: number
  sixes?: number
  run_outs?: number
  // football
  goals?: number
  assists?: number
  saves?: number
  clean_sheet?: boolean
  yellows?: number
  reds?: number
}

/** Points for simply being in the XI, both sports. A benched pick scores nothing. */
export const APPEARANCE_POINTS = 2

export const CRICKET_POINTS = {
  runs: 1,
  wickets: 25,
  catches: 8,
  sixes: 2,      // bonus, on top of the run itself
  run_outs: 12,
} as const

export const FOOTBALL_POINTS = {
  goals: 10,
  assists: 6,
  saves: 3,
  clean_sheet: 6,
  yellows: -2,
  reds: -6,
} as const

export const CAPTAIN_MULTIPLIER = 2
export const VICE_CAPTAIN_MULTIPLIER = 1.5

const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Points a single player earned. Zero if they did not play. */
export function playerPoints(stats: PlayerStats, sport: FantasySport): number {
  if (!stats.played) return 0

  if (sport === 'cricket') {
    return (
      APPEARANCE_POINTS +
      n(stats.runs)     * CRICKET_POINTS.runs +
      n(stats.wickets)  * CRICKET_POINTS.wickets +
      n(stats.catches)  * CRICKET_POINTS.catches +
      n(stats.sixes)    * CRICKET_POINTS.sixes +
      n(stats.run_outs) * CRICKET_POINTS.run_outs
    )
  }

  return (
    APPEARANCE_POINTS +
    n(stats.goals)   * FOOTBALL_POINTS.goals +
    n(stats.assists) * FOOTBALL_POINTS.assists +
    n(stats.saves)   * FOOTBALL_POINTS.saves +
    (stats.clean_sheet ? FOOTBALL_POINTS.clean_sheet : 0) +
    n(stats.yellows) * FOOTBALL_POINTS.yellows +
    n(stats.reds)    * FOOTBALL_POINTS.reds
  )
}

/**
 * Total for a whole XI. The captain's score is doubled and the vice-captain's
 * multiplied by 1.5; if the same player somehow holds both, only the captain
 * multiplier applies rather than the two compounding.
 */
export function entryPoints(
  playerIds: string[],
  captainId: string,
  viceCaptainId: string,
  statsByPlayer: Map<string, PlayerStats>,
  sport: FantasySport,
): number {
  let total = 0
  for (const id of playerIds) {
    const stats = statsByPlayer.get(id)
    if (!stats) continue
    const base = playerPoints(stats, sport)
    const multiplier =
      id === captainId ? CAPTAIN_MULTIPLIER
      : id === viceCaptainId ? VICE_CAPTAIN_MULTIPLIER
      : 1
    total += base * multiplier
  }
  return round2(total)
}

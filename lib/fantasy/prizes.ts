/**
 * Contest ranking and prize distribution.
 *
 * Same pool discipline as the betting engine: fees pool, the house takes a
 * fixed edge, and the remainder is shared out — by rank here rather than by
 * outcome. Awards are rounded DOWN to the paisa so the total is provably
 * within the pool; rounding to nearest lets a few winners drift the sum above
 * it, which is how the betting settlement broke its own solvency invariant.
 */

/** Below this, there is no meaningful contest — entries are refunded. */
export const MIN_ENTRANTS = 4

export const SPLIT_LARGE = [40, 25, 15, 12, 8] as const  // 10+ entrants
export const SPLIT_SMALL = [50, 30, 20] as const         // 4-9 entrants

export interface RankedEntry {
  entry_id: string
  user_id: string
  total_points: number
}

export interface PrizeAward {
  entry_id: string
  user_id: string
  rank: number
  amount: number
}

const floor2 = (v: number) => Math.floor(v * 100) / 100

/** Percentage splits for a given field size, or null when the contest voids. */
export function prizeSplits(entrants: number): number[] | null {
  if (entrants < MIN_ENTRANTS) return null
  return entrants >= 10 ? [...SPLIT_LARGE] : [...SPLIT_SMALL]
}

/** Fees in, house edge off. */
export function prizePool(entryFee: number, entrants: number, houseEdgePct: number): number {
  const gross = Number(entryFee) * entrants
  return floor2(gross * (1 - Number(houseEdgePct) / 100))
}

/**
 * Rank by points descending and hand out the pool.
 *
 * Ties use standard competition ranking: two players tied for 2nd both rank
 * 2nd, share the money for places 2 and 3 equally, and the next player is 4th.
 */
export function distributePrizes(entries: RankedEntry[], pool: number): PrizeAward[] {
  if (entries.length === 0) return []

  const splits = prizeSplits(entries.length)
  const sorted = [...entries].sort((a, b) => b.total_points - a.total_points)

  // group equal scores together, preserving order
  const groups: RankedEntry[][] = []
  for (const entry of sorted) {
    const last = groups[groups.length - 1]
    if (last && last[0].total_points === entry.total_points) last.push(entry)
    else groups.push([entry])
  }

  const awards: PrizeAward[] = []
  let place = 1
  for (const group of groups) {
    const rank = place
    let share = 0
    if (splits) {
      // sum the percentages for every place this group occupies
      let pct = 0
      for (let i = place; i < place + group.length; i++) {
        pct += splits[i - 1] ?? 0
      }
      share = floor2((pool * pct) / 100 / group.length)
    }
    for (const entry of group) {
      awards.push({ entry_id: entry.entry_id, user_id: entry.user_id, rank, amount: share })
    }
    place += group.length
  }

  return awards
}

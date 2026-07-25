/**
 * Pari-mutuel pool maths.
 *
 * Pure and dependency-free so it can run identically in the browser (to project
 * odds) and on the server (to settle). No odds are ever locked: a bettor's
 * payout is their proportional share of the pool at settlement.
 *
 * Money arrives from PostgREST as strings because the columns are NUMERIC, so
 * every read goes through Number().
 */

export interface PoolOption {
  id: string
  total_amount_bet: number | string
  seed_amount: number | string
}

/** Money backing one option: real stakes plus the house seed allocated to it. */
export function optionTotal(option: PoolOption): number {
  return Number(option.total_amount_bet) + Number(option.seed_amount)
}

/** Everything in the market: all stakes plus the whole house seed. */
export function poolTotal(options: PoolOption[]): number {
  return options.reduce((sum, o) => sum + optionTotal(o), 0)
}

/**
 * Live projected odds for an option, as a multiplier on stake.
 *
 * This is a projection, never a promise: it moves as money enters the pool and
 * the bettor is paid whatever the ratio is at settlement.
 *
 * `extraStake` simulates the odds after a prospective bet, so the bet slip can
 * show the price the bettor would actually be joining at.
 */
export function projectedOdds(
  options: PoolOption[],
  optionId: string,
  houseEdgePct: number,
  extraStake = 0,
): number {
  const option = options.find((o) => o.id === optionId)
  if (!option) return 0

  const onOption = optionTotal(option) + extraStake
  if (onOption <= 0) return 0

  const payoutPool = (poolTotal(options) + extraStake) * (1 - houseEdgePct / 100)
  return payoutPool / onOption
}

/** "3.17x", or an em dash when there is no meaningful price. */
export function formatOdds(odds: number): string {
  if (!odds || !Number.isFinite(odds)) return '—'
  return `${odds.toFixed(2)}x`
}

/** What a stake would return at the given projected odds, to the paisa. */
export function projectedReturn(stake: number, odds: number): number {
  return Math.round(stake * odds * 100) / 100
}

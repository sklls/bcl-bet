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

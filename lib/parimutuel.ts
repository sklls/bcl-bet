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

/** Bets placed within this window of market creation earn a larger share. */
export const EARLY_BIRD_WINDOW_MS = 30 * 60 * 1000

/**
 * Early bets count as 1.1x their stake when dividing the pool.
 *
 * Deliberately a *weight*, not the flat +10% payout bonus the old
 * settle_market applied. A flat bonus creates money the pool does not hold and
 * breaks self-funding; a weight redistributes the same pool toward early money.
 */
export const EARLY_BIRD_WEIGHT = 1.1

export interface SettleBet {
  id: string
  user_id: string
  bet_option_id: string
  amount: number | string
  placed_at: string
}

export interface SettleInput {
  options: PoolOption[]
  bets: SettleBet[]
  winningOptionId: string
  houseEdgePct: number
  marketCreatedAt: string
}

export interface Payout {
  bet_id: string
  user_id: string
  amount: number
}

export type SettleResult =
  | {
      kind: 'void'
      reason: 'no_winning_bets' | 'single_sided'
      refunds: Payout[]
    }
  | {
      kind: 'paid'
      payouts: Payout[]
      losingBetIds: string[]
      houseTake: number
    }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Stake weight for share purposes: 1.1x inside the early-bird window. */
function betWeight(bet: SettleBet, marketCreatedAt: string): number {
  const placed = new Date(bet.placed_at).getTime()
  const cutoff = new Date(marketCreatedAt).getTime() + EARLY_BIRD_WINDOW_MS
  return Number(bet.amount) * (placed < cutoff ? EARLY_BIRD_WEIGHT : 1)
}

/**
 * Work out who gets paid what.
 *
 * Pure: it reads no clock and touches no database, so every branch is testable.
 * The caller is responsible for applying the result atomically.
 */
export function settleMarket(input: SettleInput): SettleResult {
  const { options, bets, winningOptionId, houseEdgePct, marketCreatedAt } = input

  const refundAll = (reason: 'no_winning_bets' | 'single_sided'): SettleResult => ({
    kind: 'void',
    reason,
    refunds: bets.map((b) => ({
      bet_id: b.id,
      user_id: b.user_id,
      amount: round2(Number(b.amount)),
    })),
  })

  // Order matters: "nobody backed the winner" is the more specific diagnosis, so
  // it is reported in preference to the single-sided one when both hold (all the
  // money on one option, and the *other* option won).
  const winners = bets.filter((b) => b.bet_option_id === winningOptionId)
  if (winners.length === 0) return refundAll('no_winning_bets')

  // A market where only one option attracted real money was never a contest.
  // Test real bets, not stake: every option holds seed money once seeded.
  const optionsWithBets = new Set(bets.map((b) => b.bet_option_id))
  if (optionsWithBets.size < 2) return refundAll('single_sided')

  const pool = poolTotal(options)
  const payoutPool = pool * (1 - houseEdgePct / 100)

  // The seed sits on the winning option too and takes its share, which is
  // simply never disbursed — that is how the house recovers most of the seed.
  const winningOption = options.find((o) => o.id === winningOptionId)
  const seedOnWinner = winningOption ? Number(winningOption.seed_amount) : 0
  const weightedStakes = winners.map((b) => betWeight(b, marketCreatedAt))
  const totalWeight = weightedStakes.reduce((s, w) => s + w, 0) + seedOnWinner

  let payouts: Payout[] = winners.map((b, i) => ({
    bet_id: b.id,
    user_id: b.user_id,
    amount: round2(payoutPool * (weightedStakes[i] / totalWeight)),
  }))

  // Nobody should win a bet and end up down. If the rake would push a winner
  // below their stake, hand back the stake and let the house take less.
  payouts = payouts.map((p, i) => ({
    ...p,
    amount: Math.max(p.amount, round2(Number(winners[i].amount))),
  }))

  const paid = payouts.reduce((s, p) => s + p.amount, 0)

  return {
    kind: 'paid',
    payouts,
    losingBetIds: bets.filter((b) => b.bet_option_id !== winningOptionId).map((b) => b.id),
    houseTake: round2(pool - paid),
  }
}

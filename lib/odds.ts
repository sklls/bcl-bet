export interface BetOption {
  id: string
  total_amount_bet: number
}

/**
 * Pari-mutuel odds calculation.
 * Simulates the odds AFTER p_newAmount is added to the selected option.
 * Returns odds as a multiplier (e.g. 2.5 means 2.5x the stake returned).
 */
export function calculateOdds(
  options: BetOption[],
  selectedOptionId: string,
  newBetAmount: number,
  houseEdgePct: number = 5
): number {
  const totalPool =
    options.reduce((sum, o) => sum + Number(o.total_amount_bet), 0) +
    newBetAmount

  const selectedOption = options.find((o) => o.id === selectedOptionId)
  if (!selectedOption) return 1.01

  const amountOnSelection =
    Number(selectedOption.total_amount_bet) + newBetAmount

  if (amountOnSelection === 0) return 1.01

  const houseMultiplier = 1 - houseEdgePct / 100
  const rawOdds = totalPool / amountOnSelection
  const finalOdds = rawOdds * houseMultiplier

  // Minimum 1.01 so bettor always gets at least their stake back
  return Math.max(1.01, parseFloat(finalOdds.toFixed(4)))
}

/** Format odds for display: e.g. 2.5 → "2.50x" */
export function formatOdds(odds: number): string {
  return `${odds.toFixed(2)}x`
}

/** Calculate potential payout */
export function calcPayout(amount: number, odds: number): number {
  return parseFloat((amount * odds).toFixed(2))
}

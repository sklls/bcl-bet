/**
 * In-game credits — the only unit of value in this app.
 *
 * PrimeStake is free-to-play. Credits are issued by an admin, have no cash
 * value, cannot be bought, and cannot be withdrawn or exchanged for money.
 * Everything a user "wins" is credits returning to their in-game balance.
 *
 * This module exists so that unit is written in exactly one place. Do not
 * hand-format balances with a currency symbol anywhere in the UI.
 */

export const CREDIT_SUFFIX = 'CR'

const n = (v: number | string) => {
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : 0
}

/** `1,250 CR` — the standard way to show any credit amount. */
export function formatCredits(value: number | string): string {
  return `${n(value).toLocaleString('en-IN')} ${CREDIT_SUFFIX}`
}

/** `+450 CR` / `-120 CR` — for profit-and-loss figures, where sign carries meaning. */
export function formatCreditsSigned(value: number | string): string {
  const v = n(value)
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('en-IN')} ${CREDIT_SUFFIX}`
}

import { describe, it, expect } from 'vitest'
import { poolTotal, optionTotal } from './parimutuel'

describe('pool totals', () => {
  it('sums stakes and seeds across every option', () => {
    const options = [
      { id: 'a', total_amount_bet: 900, seed_amount: 500 },
      { id: 'b', total_amount_bet: 100, seed_amount: 500 },
    ]
    expect(poolTotal(options)).toBe(2000)
  })

  it('counts seed as part of an option total', () => {
    expect(optionTotal({ id: 'a', total_amount_bet: 100, seed_amount: 500 })).toBe(600)
  })

  it('coerces the strings PostgREST returns for NUMERIC columns', () => {
    const options = [
      { id: 'a', total_amount_bet: '900.00', seed_amount: '500.00' },
      { id: 'b', total_amount_bet: '100.50', seed_amount: '500.00' },
    ]
    expect(poolTotal(options)).toBe(2000.5)
  })

  it('treats a market with no bets as just the seed', () => {
    const options = [
      { id: 'a', total_amount_bet: 0, seed_amount: 500 },
      { id: 'b', total_amount_bet: 0, seed_amount: 500 },
    ]
    expect(poolTotal(options)).toBe(1000)
  })
})

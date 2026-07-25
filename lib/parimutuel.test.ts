import { describe, it, expect } from 'vitest'
import { poolTotal, optionTotal, projectedOdds, formatOdds, projectedReturn } from './parimutuel'

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

describe('projected odds', () => {
  const options = [
    { id: 'titans', total_amount_bet: 100, seed_amount: 500 },
    { id: 'devils', total_amount_bet: 900, seed_amount: 500 },
  ]

  it('divides the payout pool by the money on that option', () => {
    // pool 2000, payout pool 1900, titans holds 600 -> 3.1667
    expect(projectedOdds(options, 'titans', 5)).toBeCloseTo(3.1667, 3)
  })

  it('shortens the price when a prospective stake is included', () => {
    // pool 7000, payout pool 6650, titans holds 5600 -> 1.1875
    expect(projectedOdds(options, 'titans', 5, 5000)).toBeCloseTo(1.1875, 4)
  })

  it('is symmetric across options', () => {
    // pool 2000, payout pool 1900, devils holds 1400 -> 1.3571
    expect(projectedOdds(options, 'devils', 5)).toBeCloseTo(1.3571, 3)
  })

  it('gives a sane opening price on an unbet but seeded market', () => {
    const fresh = [
      { id: 'a', total_amount_bet: 0, seed_amount: 500 },
      { id: 'b', total_amount_bet: 0, seed_amount: 500 },
    ]
    // pool 1000, payout pool 950, option holds 500 -> 1.9
    expect(projectedOdds(fresh, 'a', 5)).toBeCloseTo(1.9, 5)
  })

  it('never returns Infinity when an option somehow holds nothing', () => {
    const broken = [
      { id: 'a', total_amount_bet: 0, seed_amount: 0 },
      { id: 'b', total_amount_bet: 500, seed_amount: 0 },
    ]
    expect(projectedOdds(broken, 'a', 5)).toBe(0)
  })

  it('returns 0 for an unknown option id', () => {
    expect(projectedOdds(options, 'nope', 5)).toBe(0)
  })

  it('formats to two decimals with an x suffix', () => {
    expect(formatOdds(3.16666)).toBe('3.17x')
    expect(formatOdds(0)).toBe('—')
  })

  it('computes a projected return', () => {
    expect(projectedReturn(100, 3.1667)).toBe(316.67)
  })
})

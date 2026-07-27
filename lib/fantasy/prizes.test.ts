import { describe, it, expect } from 'vitest'
import { prizeSplits, prizePool, distributePrizes, MIN_ENTRANTS, type RankedEntry } from './prizes'

const e = (id: string, points: number): RankedEntry => ({ entry_id: id, user_id: 'u' + id, total_points: points })

describe('prizePool', () => {
  it('takes the house edge off the total fees', () => {
    expect(prizePool(100, 10, 5)).toBe(950)
  })

  it('copes with NUMERIC strings', () => {
    expect(prizePool('100.00' as never, 4, 5)).toBe(380)
  })
})

describe('prizeSplits', () => {
  it('pays the top 5 once there are 10 entrants', () => {
    expect(prizeSplits(10)).toEqual([40, 25, 15, 12, 8])
  })

  it('pays the top 3 between 4 and 9 entrants', () => {
    expect(prizeSplits(4)).toEqual([50, 30, 20])
    expect(prizeSplits(9)).toEqual([50, 30, 20])
  })

  it('returns null below the minimum, meaning void', () => {
    expect(prizeSplits(MIN_ENTRANTS - 1)).toBeNull()
    expect(prizeSplits(0)).toBeNull()
  })

  it('always sums to 100 percent', () => {
    for (const n of [4, 9, 10, 17, 50]) {
      const s = prizeSplits(n)!
      expect(s.reduce((a, b) => a + b, 0)).toBe(100)
    }
  })
})

describe('distributePrizes', () => {
  it('pays a clean top 3 in a 5-entrant contest', () => {
    const awards = distributePrizes(
      [e('a', 100), e('b', 90), e('c', 80), e('d', 70), e('e', 60)], 500)
    expect(awards.find(a => a.entry_id === 'a')).toMatchObject({ rank: 1, amount: 250 })
    expect(awards.find(a => a.entry_id === 'b')).toMatchObject({ rank: 2, amount: 150 })
    expect(awards.find(a => a.entry_id === 'c')).toMatchObject({ rank: 3, amount: 100 })
    expect(awards.find(a => a.entry_id === 'd')).toMatchObject({ rank: 4, amount: 0 })
  })

  it('splits the combined prize when two tie for second', () => {
    // places 2 and 3 are worth 30% + 20% = 50% of 500 = 250, so 125 each
    const awards = distributePrizes([e('a', 100), e('b', 90), e('c', 90), e('d', 70)], 500)
    expect(awards.find(a => a.entry_id === 'b')!.amount).toBe(125)
    expect(awards.find(a => a.entry_id === 'c')!.amount).toBe(125)
    expect(awards.find(a => a.entry_id === 'b')!.rank).toBe(2)
    expect(awards.find(a => a.entry_id === 'c')!.rank).toBe(2)
  })

  it('makes the player after a two-way tie for 2nd finish 4th', () => {
    const awards = distributePrizes([e('a', 100), e('b', 90), e('c', 90), e('d', 70)], 500)
    expect(awards.find(a => a.entry_id === 'd')!.rank).toBe(4)
  })

  it('handles everyone tying', () => {
    const awards = distributePrizes([e('a', 50), e('b', 50), e('c', 50), e('d', 50)], 400)
    for (const a of awards) {
      expect(a.rank).toBe(1)
      expect(a.amount).toBe(100)
    }
  })

  it('never pays out more than the pool', () => {
    const cases: RankedEntry[][] = [
      [e('a', 10), e('b', 10), e('c', 10), e('d', 10), e('e', 10)],
      [e('a', 3), e('b', 3), e('c', 1), e('d', 1), e('e', 1), e('f', 1), e('g', 0), e('h', 0), e('i', 0), e('j', 0)],
      Array.from({ length: 17 }, (_, i) => e('x' + i, i % 3)),
    ]
    for (const entries of cases) {
      const pool = 1000 / 3   // deliberately awkward
      const total = distributePrizes(entries, pool).reduce((s, a) => s + a.amount, 0)
      expect(total).toBeLessThanOrEqual(pool)
    }
  })

  it('rounds awards down so the remainder stays with the house', () => {
    // 3 tied for 1st in a 10-entrant split: places 1-3 = 80% of 100 = 80, /3 = 26.666…
    const entries = Array.from({ length: 10 }, (_, i) => e('p' + i, i < 3 ? 9 : 1))
    const awards = distributePrizes(entries, 100)
    const top = awards.filter(a => a.rank === 1)
    expect(top).toHaveLength(3)
    for (const a of top) expect(a.amount).toBe(26.66)
  })

  it('returns an empty list for an empty contest', () => {
    expect(distributePrizes([], 500)).toEqual([])
  })

  it('pays nobody when the contest is below the minimum', () => {
    const awards = distributePrizes([e('a', 100), e('b', 50)], 190)
    expect(awards.every(a => a.amount === 0)).toBe(true)
  })
})

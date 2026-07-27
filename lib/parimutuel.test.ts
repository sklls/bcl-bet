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

import { settleMarket, EARLY_BIRD_WEIGHT } from './parimutuel'

const CREATED = '2026-08-01T10:00:00.000Z'
const EARLY   = '2026-08-01T10:10:00.000Z'   // inside the 30 min window
const LATE    = '2026-08-01T11:00:00.000Z'   // outside it

describe('settleMarket', () => {
  it('splits the payout pool pro-rata among winners', () => {
    const result = settleMarket({
      options: [
        { id: 'titans', total_amount_bet: 5100, seed_amount: 500 },
        { id: 'devils', total_amount_bet: 900, seed_amount: 500 },
      ],
      bets: [
        { id: 'b1', user_id: 'u1', bet_option_id: 'titans', amount: 100,  placed_at: LATE },
        { id: 'b2', user_id: 'u2', bet_option_id: 'titans', amount: 5000, placed_at: LATE },
        { id: 'b3', user_id: 'u3', bet_option_id: 'devils', amount: 900,  placed_at: LATE },
      ],
      winningOptionId: 'titans',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })

    expect(result.kind).toBe('paid')
    if (result.kind !== 'paid') return

    // pool 7000, payout pool 6650, titans weighted total 5600 (incl. 500 seed)
    const b1 = result.payouts.find((p) => p.bet_id === 'b1')!
    const b2 = result.payouts.find((p) => p.bet_id === 'b2')!
    expect(b1.amount).toBeCloseTo(118.75, 2)   // 6650 * 100/5600
    expect(b2.amount).toBeCloseTo(5937.5, 2)   // 6650 * 5000/5600
    expect(result.losingBetIds).toEqual(['b3'])
  })

  it('kills the 1-credit exploit — a tiny stake gets a tiny share', () => {
    const result = settleMarket({
      options: [
        { id: 'sky', total_amount_bet: 5101, seed_amount: 500 },
        { id: 'dev', total_amount_bet: 6900, seed_amount: 500 },
      ],
      bets: [
        { id: 'tiny', user_id: 'u1', bet_option_id: 'sky', amount: 1,    placed_at: LATE },
        { id: 'big',  user_id: 'u2', bet_option_id: 'sky', amount: 5100, placed_at: LATE },
        { id: 'oth',  user_id: 'u3', bet_option_id: 'dev', amount: 6900, placed_at: LATE },
      ],
      winningOptionId: 'sky',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')
    const tiny = result.payouts.find((p) => p.bet_id === 'tiny')!
    // under the old locked-odds engine this bet returned 5700.95 CR
    expect(tiny.amount).toBeLessThan(3)
  })

  it('never pays out more than the pool holds', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 1000, seed_amount: 500 },
        { id: 'b', total_amount_bet: 2000, seed_amount: 500 },
      ],
      bets: [
        { id: 'b1', user_id: 'u1', bet_option_id: 'a', amount: 400, placed_at: EARLY },
        { id: 'b2', user_id: 'u2', bet_option_id: 'a', amount: 600, placed_at: LATE },
        { id: 'b3', user_id: 'u3', bet_option_id: 'b', amount: 2000, placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')
    const total = result.payouts.reduce((s, p) => s + p.amount, 0)
    expect(total).toBeLessThanOrEqual(4000)
  })

  it('weights early bets at 1.1x share rather than paying a flat bonus', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 200, seed_amount: 0 },
        { id: 'b', total_amount_bet: 800, seed_amount: 0 },
      ],
      bets: [
        { id: 'early', user_id: 'u1', bet_option_id: 'a', amount: 100, placed_at: EARLY },
        { id: 'late',  user_id: 'u2', bet_option_id: 'a', amount: 100, placed_at: LATE },
        { id: 'other', user_id: 'u3', bet_option_id: 'b', amount: 800, placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')
    const early = result.payouts.find((p) => p.bet_id === 'early')!
    const late  = result.payouts.find((p) => p.bet_id === 'late')!
    expect(early.amount / late.amount).toBeCloseTo(EARLY_BIRD_WEIGHT, 5)
    // still self-funding
    expect(early.amount + late.amount).toBeLessThanOrEqual(1000)
  })

  it('voids and refunds when nobody backed the winner', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 0,    seed_amount: 500 },
        { id: 'b', total_amount_bet: 2200, seed_amount: 500 },
      ],
      bets: [
        { id: 'b1', user_id: 'u1', bet_option_id: 'b', amount: 2200, placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    expect(result.kind).toBe('void')
    if (result.kind !== 'void') return
    expect(result.reason).toBe('no_winning_bets')
    expect(result.refunds).toEqual([{ bet_id: 'b1', user_id: 'u1', amount: 2200 }])
  })

  it('voids when only one option received real bets', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 1000, seed_amount: 500 },
        { id: 'b', total_amount_bet: 0,    seed_amount: 500 },
      ],
      bets: [
        { id: 'b1', user_id: 'u1', bet_option_id: 'a', amount: 1000, placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    expect(result.kind).toBe('void')
    if (result.kind !== 'void') return
    expect(result.reason).toBe('single_sided')
  })

  it('guarantees the stake back rather than paying a winner less than they staked', () => {
    // 990 of a 1000 pool is on the winner; a 5% rake would leave winners short
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 990, seed_amount: 0 },
        { id: 'b', total_amount_bet: 10,  seed_amount: 0 },
      ],
      bets: [
        { id: 'b1', user_id: 'u1', bet_option_id: 'a', amount: 990, placed_at: LATE },
        { id: 'b2', user_id: 'u2', bet_option_id: 'b', amount: 10,  placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')
    const b1 = result.payouts.find((p) => p.bet_id === 'b1')!
    expect(b1.amount).toBeGreaterThanOrEqual(990)
    expect(result.houseTake).toBeLessThan(50)
  })

  it('never overpays when the stake guarantee and early-bird weight combine', () => {
    // Regression: the per-bet guarantee used to stack with the early-bird
    // weight and pay out 10049.74 from a 10001 pool, driving houseTake to
    // -48.74 and making the market unsettleable behind the SQL solvency guard.
    const options = [
      { id: 'a', total_amount_bet: 10000, seed_amount: 0 },
      { id: 'b', total_amount_bet: 1, seed_amount: 0 },
    ]
    const result = settleMarket({
      options,
      bets: [
        { id: 'early', user_id: 'u1', bet_option_id: 'a', amount: 2200, placed_at: EARLY },
        { id: 'late',  user_id: 'u2', bet_option_id: 'a', amount: 7800, placed_at: LATE },
        { id: 'lose',  user_id: 'u3', bet_option_id: 'b', amount: 1,    placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')

    const paid = result.payouts.reduce((s, p) => s + p.amount, 0)
    expect(paid).toBeLessThanOrEqual(poolTotal(options))
    expect(result.houseTake).toBeGreaterThanOrEqual(0)

    // the guarantee still holds for both winners
    expect(result.payouts.find((p) => p.bet_id === 'early')!.amount).toBeGreaterThanOrEqual(2200)
    expect(result.payouts.find((p) => p.bet_id === 'late')!.amount).toBeGreaterThanOrEqual(7800)
  })

  it('holds the solvency invariant across the whole guarantee/early-bird boundary', () => {
    // The overshoot lived where the losing side was under ~0.66% of the pool
    // and the winning option carried no seed. These walk that boundary and out
    // the far side of it, plus the degenerate all-early / all-late shapes.
    const cases: Array<{ early: number; late: number; lose: number; seed: number }> = [
      { early: 2200,  late: 7800, lose: 1,    seed: 0 },   // the reported case
      { early: 2225,  late: 7775, lose: 1,    seed: 0 },   // analytic worst point
      { early: 2270,  late: 7730, lose: 10,   seed: 0 },
      { early: 2310,  late: 7690, lose: 20,   seed: 0 },
      { early: 2360,  late: 7640, lose: 30,   seed: 0 },
      { early: 2470,  late: 7530, lose: 50,   seed: 0 },
      { early: 2510,  late: 7490, lose: 60,   seed: 0 },   // 0.60% — last unsafe
      { early: 2610,  late: 7390, lose: 80,   seed: 0 },   // 0.79% — first safe
      { early: 2720,  late: 7280, lose: 100,  seed: 0 },
      { early: 2760,  late: 7240, lose: 1,    seed: 100 }, // seed alone mitigates
      { early: 4840,  late: 5160, lose: 1,    seed: 500 },
      { early: 0,     late: 10000, lose: 1,   seed: 0 },   // all late
      { early: 10000, late: 0,    lose: 1,    seed: 0 },   // all early
      { early: 495,   late: 495,  lose: 10,   seed: 0 },   // guarantee binds hard
      { early: 1,     late: 1,    lose: 0.01, seed: 0 },   // sub-unit pool
    ]

    for (const c of cases) {
      const bets = []
      if (c.early > 0)
        bets.push({ id: 'e', user_id: 'ue', bet_option_id: 'a', amount: c.early, placed_at: EARLY })
      if (c.late > 0)
        bets.push({ id: 'l', user_id: 'ul', bet_option_id: 'a', amount: c.late, placed_at: LATE })
      bets.push({ id: 'x', user_id: 'ux', bet_option_id: 'b', amount: c.lose, placed_at: LATE })

      const options = [
        { id: 'a', total_amount_bet: c.early + c.late, seed_amount: c.seed },
        { id: 'b', total_amount_bet: c.lose, seed_amount: c.seed },
      ]
      const result = settleMarket({
        options,
        bets,
        winningOptionId: 'a',
        houseEdgePct: 5,
        marketCreatedAt: CREATED,
      })

      const label = JSON.stringify(c)
      if (result.kind !== 'paid') throw new Error(`expected paid for ${label}`)

      const pool = poolTotal(options)
      const paid = result.payouts.reduce((s, p) => s + p.amount, 0)
      expect(paid, `overpaid for ${label}`).toBeLessThanOrEqual(pool)
      expect(result.houseTake, `negative houseTake for ${label}`).toBeGreaterThanOrEqual(0)

      // and the guarantee is never sacrificed to achieve it
      for (const p of result.payouts) {
        const stake = p.bet_id === 'e' ? c.early : c.late
        expect(p.amount, `winner below stake for ${label}`).toBeGreaterThanOrEqual(stake)
      }
    }
  })

  it('holds the invariant with many winners, where per-payout rounding could re-breach it', () => {
    // Capping the surplus makes the *unrounded* total exactly the pool, so
    // rounding 50 payouts to nearest would drift up to +0.25 over it — measured
    // at +0.06 here, still past the SQL guard's 0.01 tolerance. Truncating the
    // scaled surplus is what keeps this at or under the pool.
    const bets = Array.from({ length: 50 }, (_, i) => ({
      id: `w${i}`,
      user_id: `u${i}`,
      bet_option_id: 'a',
      amount: Math.round((100 + ((i * 37.77) % 411)) * 100) / 100,
      placed_at: i < 15 ? EARLY : LATE,
    }))
    const winStake = Math.round(bets.reduce((s, b) => s + b.amount, 0) * 100) / 100
    const options = [
      { id: 'a', total_amount_bet: winStake, seed_amount: 0 },
      { id: 'b', total_amount_bet: 1, seed_amount: 0 },
    ]
    const result = settleMarket({
      options,
      bets: [...bets, { id: 'x', user_id: 'ux', bet_option_id: 'b', amount: 1, placed_at: LATE }],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')

    const paid = result.payouts.reduce((s, p) => s + p.amount, 0)
    expect(paid).toBeLessThanOrEqual(poolTotal(options))
    expect(result.houseTake).toBeGreaterThanOrEqual(0)
    for (const p of result.payouts) {
      const stake = bets.find((b) => b.id === p.bet_id)!.amount
      expect(p.amount).toBeGreaterThanOrEqual(stake)
    }
  })

  it('stays solvent when option totals lag behind the bets being settled', () => {
    // The settle route reads bet_options and bets in two separate queries, so a
    // bet landing between them can leave option.total_amount_bet lagging what
    // the bets array actually owes. Capacity must come from whichever is
    // larger, or the guarantee floor overpays against a stale, too-small pool.
    const options = [
      { id: 'a', total_amount_bet: 100, seed_amount: 0 },
      { id: 'b', total_amount_bet: 1, seed_amount: 0 },
    ]
    const bets = [
      { id: 'e', user_id: 'u', bet_option_id: 'a', amount: 9000, placed_at: EARLY },
      { id: 'x', user_id: 'v', bet_option_id: 'b', amount: 1, placed_at: LATE },
    ]
    const result = settleMarket({
      options,
      bets,
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')

    const betsTotal = bets.reduce((s, b) => s + Number(b.amount), 0)
    const seedTotal = options.reduce((s, o) => s + Number(o.seed_amount), 0)
    const capacity = Math.max(poolTotal(options), betsTotal + seedTotal)

    const paid = result.payouts.reduce((s, p) => s + p.amount, 0)
    expect(paid).toBeLessThanOrEqual(capacity)
    expect(result.houseTake).toBeGreaterThanOrEqual(0)
    expect(result.payouts.find((p) => p.bet_id === 'e')!.amount).toBeGreaterThanOrEqual(9000)
  })

  it('ignores malformed money values rather than poisoning the pool', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 1000, seed_amount: undefined as any },
        { id: 'b', total_amount_bet: 100, seed_amount: 0 },
      ],
      bets: [
        { id: 'e', user_id: 'u1', bet_option_id: 'a', amount: 'not-a-number' as any, placed_at: EARLY },
        { id: 'l', user_id: 'u2', bet_option_id: 'a', amount: 1000, placed_at: LATE },
        { id: 'x', user_id: 'u3', bet_option_id: 'b', amount: 100, placed_at: LATE },
      ],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    if (result.kind !== 'paid') throw new Error('expected paid')

    for (const p of result.payouts) {
      expect(Number.isNaN(p.amount)).toBe(false)
    }
    expect(Number.isFinite(result.houseTake)).toBe(true)
    expect(result.houseTake).toBeGreaterThanOrEqual(0)
  })

  it('returns void with no refunds when there were no bets at all', () => {
    const result = settleMarket({
      options: [
        { id: 'a', total_amount_bet: 0, seed_amount: 500 },
        { id: 'b', total_amount_bet: 0, seed_amount: 500 },
      ],
      bets: [],
      winningOptionId: 'a',
      houseEdgePct: 5,
      marketCreatedAt: CREATED,
    })
    expect(result.kind).toBe('void')
    if (result.kind !== 'void') return
    expect(result.refunds).toEqual([])
  })
})

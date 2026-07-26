# Pari-mutuel Betting Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace locked odds with true pari-mutuel settlement so a ₹1 stake can no longer lock in ~95% of a pool, and seed every market with house money so displayed odds are meaningful.

**Architecture:** All payout maths lives in one pure, dependency-free module (`lib/parimutuel.ts`) that is unit tested. The API route computes payouts with those functions and hands the result to a single Postgres RPC that applies them atomically and re-validates that total payouts never exceed the pool. UI reads projected odds from the same pure module so the number a bettor sees and the number they get come from identical code.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + PostgREST + Realtime), Tailwind, Zod, Vitest.

## Global Constraints

- House edge default **5%**, stored per market on `markets.house_edge_pct`.
- House seed default **₹1000** per market, stored on `markets.seed_amount`, split equally across options into `bet_options.seed_amount`.
- Minimum stake **₹1** (`bets.amount >= 1`). There is deliberately **no higher minimum** — see spec.
- Early-bird window **30 minutes** from `markets.created_at`, worth a **1.1× stake weight** (not a flat payout bonus).
- Currency is INR, displayed with `toLocaleString('en-IN')`.
- Money columns are `NUMERIC`; always coerce with `Number()` before arithmetic — PostgREST returns them as strings.
- Existing settled bets keep `odds_at_placement`; it becomes display-only history and is never used to compute a new payout.
- Never trust a payout computed on the client. The settle route is admin-only and uses the service-role client.

---

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Test runner config (create) |
| `lib/parimutuel.ts` | Pure pool maths: totals, projected odds, settlement outcome (create) |
| `lib/parimutuel.test.ts` | Unit tests for the above (create) |
| `supabase/migrations/007_parimutuel.sql` | Seed columns, stake floor, `place_bet` v2, `settle_market_parimutuel` (create) |
| `scripts/backfill-seeds.mjs` | Seed the 27 already-open markets (create) |
| `app/api/bets/route.ts` | Stop computing/locking odds |
| `app/api/settle/route.ts` | Compute payouts, call new RPC |
| `app/api/admin/markets/route.ts` | Accept `seed_amount`, allocate across options |
| `components/betting/MarketsSection.tsx` | Projected odds per option, seed-aware |
| `components/betting/BetSlip.tsx` | Projected payout + "not locked" copy |
| `lib/odds.ts` | Deleted in Task 7 once no consumers remain |

---

## Task 1: Test infrastructure and pool totals

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/parimutuel.ts`
- Create: `lib/parimutuel.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `PoolOption` interface `{ id: string; total_amount_bet: number | string; seed_amount: number | string }`; `poolTotal(options: PoolOption[]): number`; `optionTotal(option: PoolOption): number`

- [ ] **Step 1: Install the test runner**

```bash
npm install --save-dev vitest@^2.1.0
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 3: Add the test script to `package.json`**

In the `"scripts"` block, after `"lint": "next lint"`, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

Create `lib/parimutuel.test.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./parimutuel"`

- [ ] **Step 6: Write minimal implementation**

Create `lib/parimutuel.ts`:

```ts
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 4 tests

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json lib/parimutuel.ts lib/parimutuel.test.ts
git commit -m "feat: add vitest and pari-mutuel pool totals"
```

---

## Task 2: Projected odds

**Files:**
- Modify: `lib/parimutuel.ts`
- Modify: `lib/parimutuel.test.ts`

**Interfaces:**
- Consumes: `PoolOption`, `poolTotal`, `optionTotal` from Task 1
- Produces: `projectedOdds(options: PoolOption[], optionId: string, houseEdgePct: number, extraStake?: number): number`; `formatOdds(odds: number): string`; `projectedReturn(stake: number, odds: number): number`

- [ ] **Step 1: Write the failing test**

Append to `lib/parimutuel.test.ts`:

```ts
import { projectedOdds, formatOdds, projectedReturn } from './parimutuel'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `projectedOdds is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `lib/parimutuel.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/parimutuel.ts lib/parimutuel.test.ts
git commit -m "feat: pari-mutuel projected odds"
```

---

## Task 3: Settlement, including every void case

**Files:**
- Modify: `lib/parimutuel.ts`
- Modify: `lib/parimutuel.test.ts`

**Interfaces:**
- Consumes: `PoolOption`, `poolTotal`, `optionTotal` from Task 1
- Produces: `SettleBet` interface; `SettleResult` discriminated union; `settleMarket(input: SettleInput): SettleResult`; constants `EARLY_BIRD_WINDOW_MS`, `EARLY_BIRD_WEIGHT`

- [ ] **Step 1: Write the failing test**

Append to `lib/parimutuel.test.ts`:

```ts
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

  it('kills the ₹1 exploit — a tiny stake gets a tiny share', () => {
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
    // under the old locked-odds engine this bet returned ₹5700.95
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `settleMarket is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `lib/parimutuel.ts`:

```ts
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

  // A market where only one option attracted real money was never a contest.
  // Test real bets, not stake: every option holds seed money once seeded.
  const optionsWithBets = new Set(bets.map((b) => b.bet_option_id))
  if (optionsWithBets.size < 2) return refundAll('single_sided')

  const winners = bets.filter((b) => b.bet_option_id === winningOptionId)
  if (winners.length === 0) return refundAll('no_winning_bets')

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 20 tests

- [ ] **Step 5: Commit**

```bash
git add lib/parimutuel.ts lib/parimutuel.test.ts
git commit -m "feat: pari-mutuel settlement with void, stake guarantee and early-bird weighting"
```

---

## Task 4: Database migration

**Files:**
- Create: `supabase/migrations/007_parimutuel.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: columns `markets.seed_amount`, `bet_options.seed_amount`; RPC `place_bet(p_user_id uuid, p_market_id uuid, p_bet_option_id uuid, p_amount numeric) returns json`; RPC `apply_settlement(p_market_id uuid, p_winning_option_id uuid, p_payouts jsonb, p_losing_bet_ids uuid[], p_void boolean) returns json`

> **Sequencing warning:** this task drops the 5-argument `place_bet` and replaces
> it with a 4-argument version, while `app/api/bets/route.ts` still calls the old
> signature until Task 5. Bet placement is therefore broken between Task 4 and
> Task 5 — run them back to back and do not deploy in between.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/007_parimutuel.sql`:

```sql
-- ============================================================
-- 007_parimutuel.sql
--
-- Replaces locked odds with true pari-mutuel settlement.
--
-- Under the old engine place_bet stored odds_at_placement and settle_market
-- paid amount * odds_at_placement. That let a ₹1 stake on an untouched option
-- lock in ~95% of the whole pool (observed: ₹1 at 5700.95x). Payouts are now
-- computed from the pool at settlement, so a stake earns only its share.
-- ============================================================

-- ------------------------------------------------------------
-- 1. House seeding
-- ------------------------------------------------------------
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS seed_amount NUMERIC(10,2) NOT NULL DEFAULT 1000;

-- Per-option allocation, kept separate from total_amount_bet so house money
-- stays distinguishable from real stakes in accounting and the bettors list.
ALTER TABLE bet_options
  ADD COLUMN IF NOT EXISTS seed_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. Stake floor. Sub-rupee stakes were legal on a DECIMAL(10,2) column.
-- ------------------------------------------------------------
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_amount_check;
ALTER TABLE bets ADD CONSTRAINT bets_amount_check CHECK (amount >= 1);

-- odds_at_placement is history only from here on.
ALTER TABLE bets ALTER COLUMN odds_at_placement DROP NOT NULL;

-- ------------------------------------------------------------
-- 3. place_bet without odds
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS place_bet(UUID, UUID, UUID, DECIMAL, DECIMAL);

CREATE OR REPLACE FUNCTION place_bet(
  p_user_id UUID,
  p_market_id UUID,
  p_bet_option_id UUID,
  p_amount NUMERIC
) RETURNS JSON AS $$
DECLARE
  v_bet_id UUID;
  v_balance NUMERIC;
  v_status market_status;
BEGIN
  SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Market is not open for betting';
  END IF;

  SELECT wallet_balance INTO v_balance
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE profiles SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO bets (user_id, market_id, bet_option_id, amount)
  VALUES (p_user_id, p_market_id, p_bet_option_id, p_amount)
  RETURNING id INTO v_bet_id;

  UPDATE bet_options SET total_amount_bet = total_amount_bet + p_amount
  WHERE id = p_bet_option_id;

  UPDATE markets SET total_pool = total_pool + p_amount, updated_at = NOW()
  WHERE id = p_market_id;

  INSERT INTO transactions (user_id, type, amount, description, reference_id)
  VALUES (p_user_id, 'bet', -p_amount, 'Bet placed', v_bet_id);

  RETURN json_build_object('bet_id', v_bet_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Settlement application
--
-- Payouts are computed by lib/parimutuel.ts and passed in, so the maths stays
-- unit-testable. This function is the atomic applier and the last line of
-- defence: it refuses any settlement that would pay out more than the market
-- holds, whatever the caller claims.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_settlement(
  p_market_id UUID,
  p_winning_option_id UUID,
  p_payouts JSONB,          -- [{bet_id, user_id, amount}]
  p_losing_bet_ids UUID[],
  p_void BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_row JSONB;
  v_total NUMERIC := 0;
  v_capacity NUMERIC;
  v_label TEXT;
  v_count INT := 0;
BEGIN
  SELECT COALESCE(SUM(total_amount_bet + seed_amount), 0) INTO v_capacity
  FROM bet_options WHERE market_id = p_market_id;

  SELECT COALESCE(SUM((e->>'amount')::NUMERIC), 0) INTO v_total
  FROM jsonb_array_elements(p_payouts) e;

  IF v_total > v_capacity + 0.01 THEN
    RAISE EXCEPTION 'Payout % exceeds market capacity %', v_total, v_capacity;
  END IF;

  SELECT label INTO v_label FROM bet_options WHERE id = p_winning_option_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payouts)
  LOOP
    UPDATE profiles
      SET wallet_balance = wallet_balance + (v_row->>'amount')::NUMERIC
      WHERE id = (v_row->>'user_id')::UUID;

    UPDATE bets
      SET status = CASE WHEN p_void THEN 'void'::bet_status ELSE 'won'::bet_status END,
          payout = (v_row->>'amount')::NUMERIC,
          settled_at = NOW()
      WHERE id = (v_row->>'bet_id')::UUID;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (
      (v_row->>'user_id')::UUID,
      CASE WHEN p_void THEN 'refund'::transaction_type ELSE 'win'::transaction_type END,
      (v_row->>'amount')::NUMERIC,
      CASE WHEN p_void
        THEN 'Market voided — stake refunded'
        ELSE 'Bet won: ' || COALESCE(v_label, '') END,
      (v_row->>'bet_id')::UUID
    );
    v_count := v_count + 1;
  END LOOP;

  IF NOT p_void AND array_length(p_losing_bet_ids, 1) > 0 THEN
    UPDATE bets SET status = 'lost', payout = 0, settled_at = NOW()
    WHERE id = ANY(p_losing_bet_ids);
  END IF;

  UPDATE markets
    SET status = 'settled',
        result = CASE WHEN p_void THEN 'VOID' ELSE v_label END,
        updated_at = NOW()
    WHERE id = p_market_id;

  RETURN json_build_object('settled', v_count, 'total_paid', v_total, 'void', p_void);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Apply it**

Run: `SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-migration.mjs supabase/migrations/007_parimutuel.sql`
Expected: `OK: []`

- [ ] **Step 3: Verify the columns and functions exist**

Run:

```bash
node -e "
import('@supabase/supabase-js').then(async ({createClient}) => {
  const fs = await import('fs')
  const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
    .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})
  for (const [t,c] of [['markets','seed_amount'],['bet_options','seed_amount']]) {
    const {error} = await sb.from(t).select(c).limit(1)
    console.log((error?'MISSING ':'OK      ')+t+'.'+c)
  }
})"
```

Expected: `OK      markets.seed_amount` and `OK      bet_options.seed_amount`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/007_parimutuel.sql
git commit -m "feat: pari-mutuel migration — seeding, stake floor, new RPCs"
```

---

## Task 5: Wire the API routes

**Files:**
- Modify: `app/api/bets/route.ts`
- Modify: `app/api/settle/route.ts`
- Modify: `app/api/admin/markets/route.ts`

**Interfaces:**
- Consumes: `settleMarket`, `SettleBet`, `PoolOption` from Task 3; `place_bet` and `apply_settlement` RPCs from Task 4
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Replace `app/api/bets/route.ts` entirely**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const BetSchema = z.object({
  market_id: z.string().uuid(),
  bet_option_id: z.string().uuid(),
  amount: z.number().positive().min(1),
})

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = BetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { market_id, bet_option_id, amount } = parsed.data
  const admin = createAdminClient()

  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('id, status, bet_options(id)')
    .eq('id', market_id)
    .single()

  if (marketErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }
  if (market.status !== 'open') {
    return NextResponse.json({ error: 'Market is not open for betting' }, { status: 400 })
  }
  if (!market.bet_options.some((o: { id: string }) => o.id === bet_option_id)) {
    return NextResponse.json({ error: 'Invalid bet option' }, { status: 400 })
  }

  // No odds are locked. The stake buys a share of the pool, priced at settlement.
  const { data, error } = await admin.rpc('place_bet', {
    p_user_id: user.id,
    p_market_id: market_id,
    p_bet_option_id: bet_option_id,
    p_amount: amount,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, bet_id: (data as { bet_id: string }).bet_id })
}
```

- [ ] **Step 2: Replace the `POST` body in `app/api/settle/route.ts`**

Keep the imports, `SettleSchema` and `verifyAdmin` as they are; replace everything from `export async function POST` to the end of the file with:

```ts
export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = SettleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { market_id, winning_option_id } = parsed.data
  const admin = createAdminClient()

  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('id, status, house_edge_pct, created_at, bet_options(id, total_amount_bet, seed_amount)')
    .eq('id', market_id)
    .single()

  if (marketErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }
  if (market.status === 'settled') {
    return NextResponse.json({ error: 'Market already settled' }, { status: 400 })
  }
  if (!market.bet_options.some((o: { id: string }) => o.id === winning_option_id)) {
    return NextResponse.json({ error: 'Winning option does not belong to this market' }, { status: 400 })
  }

  const { data: bets, error: betsErr } = await admin
    .from('bets')
    .select('id, user_id, bet_option_id, amount, placed_at')
    .eq('market_id', market_id)
    .eq('status', 'pending')

  if (betsErr) {
    return NextResponse.json({ error: betsErr.message }, { status: 500 })
  }

  const result = settleMarket({
    options: market.bet_options,
    bets: bets ?? [],
    winningOptionId: winning_option_id,
    houseEdgePct: Number(market.house_edge_pct),
    marketCreatedAt: market.created_at,
  })

  const isVoid = result.kind === 'void'
  const { data, error } = await admin.rpc('apply_settlement', {
    p_market_id: market_id,
    p_winning_option_id: winning_option_id,
    p_payouts: isVoid ? result.refunds : result.payouts,
    p_losing_bet_ids: isVoid ? [] : result.losingBetIds,
    p_void: isVoid,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    void: isVoid,
    reason: isVoid ? result.reason : undefined,
    house_take: isVoid ? 0 : result.houseTake,
    applied: data,
  })
}
```

Then change the import line at the top of the file from:

```ts
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
```

to:

```ts
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { settleMarket } from '@/lib/parimutuel'
```

- [ ] **Step 3: Seed markets on creation in `app/api/admin/markets/route.ts`**

Replace the `MarketSchema` definition (lines 5-11) with:

```ts
const MarketSchema = z.object({
  match_id: z.string().uuid(),
  market_type: z.enum(['winner', 'top_scorer', 'over_under', 'live', 'custom']),
  title: z.string().min(1).max(80).optional(), // required when market_type === 'custom'
  house_edge_pct: z.number().min(0).max(20).optional(),
  seed_amount: z.number().min(0).max(100000).optional(),
  options: z.array(z.string().min(1)).min(2), // labels for bet options
})
```

Replace the destructuring and market-creation block (the `const { match_id, ... } = parsed.data` line through the `bet_options` insert) with:

```ts
  const { match_id, market_type, title, house_edge_pct, seed_amount, options } = parsed.data
  if (market_type === 'custom' && !title?.trim()) {
    return NextResponse.json({ error: 'Title is required for custom markets' }, { status: 400 })
  }
  const admin = createAdminClient()

  const seed = seed_amount ?? 1000

  // Create market
  const { data: market, error: marketErr } = await admin
    .from('markets')
    .insert({
      match_id,
      market_type,
      title: title?.trim() ?? null,
      house_edge_pct: house_edge_pct ?? 5,
      seed_amount: seed,
    })
    .select()
    .single()

  if (marketErr) return NextResponse.json({ error: marketErr.message }, { status: 500 })

  // Split the house seed equally across the options. Seeding each option rather
  // than the pool as a whole is what keeps opening prices sane — an unseeded
  // option makes the first bet on it show absurd odds.
  const perOption = Math.round((seed / options.length) * 100) / 100
  const optionRows = options.map((label) => ({
    market_id: market.id,
    label,
    seed_amount: perOption,
  }))
  const { error: optErr } = await admin.from('bet_options').insert(optionRows)
  if (optErr) return NextResponse.json({ error: optErr.message }, { status: 500 })
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add app/api/bets/route.ts app/api/settle/route.ts app/api/admin/markets/route.ts
git commit -m "feat: wire pari-mutuel settlement and market seeding into the API"
```

---

## Task 6: Backfill seeds on existing open markets

**Files:**
- Create: `scripts/backfill-seeds.mjs`

**Interfaces:**
- Consumes: `bet_options.seed_amount` from Task 4
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the script**

Create `scripts/backfill-seeds.mjs`:

```js
/**
 * Allocate the default house seed across the options of every open market.
 *
 * Markets created before migration 007 have markets.seed_amount defaulted to
 * 1000 but bet_options.seed_amount still 0, so their options would price as if
 * unseeded. Settled markets are left alone — their payouts are already history.
 *
 *   node scripts/backfill-seeds.mjs --dry
 *   node scripts/backfill-seeds.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const DRY = process.argv.includes('--dry')

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: markets, error } = await sb
  .from('markets')
  .select('id, title, market_type, seed_amount, status, bet_options(id, seed_amount)')
  .eq('status', 'open')

if (error) { console.error(error.message); process.exit(1) }

let changed = 0
for (const m of markets) {
  const opts = m.bet_options ?? []
  if (!opts.length) continue
  if (opts.every(o => Number(o.seed_amount) > 0)) continue

  const per = Math.round((Number(m.seed_amount) / opts.length) * 100) / 100
  console.log(`${DRY ? '[dry] ' : ''}${(m.title ?? m.market_type).slice(0, 40).padEnd(42)} ${opts.length} options x ₹${per}`)

  if (!DRY) {
    for (const o of opts) {
      const { error: uErr } = await sb.from('bet_options').update({ seed_amount: per }).eq('id', o.id)
      if (uErr) { console.error('  failed:', uErr.message); process.exit(1) }
    }
  }
  changed++
}

console.log(`\n${DRY ? 'would update' : 'updated'} ${changed} of ${markets.length} open markets`)
```

- [ ] **Step 2: Dry run it**

Run: `node scripts/backfill-seeds.mjs --dry`
Expected: lists 27 open markets, each showing `2 options x ₹500`

- [ ] **Step 3: Apply it**

Run: `node scripts/backfill-seeds.mjs`
Expected: `updated 27 of 27 open markets`

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-seeds.mjs
git commit -m "chore: backfill house seed across open market options"
```

---

## Task 7: Projected-odds UI

**Files:**
- Modify: `components/betting/MarketsSection.tsx`
- Modify: `components/betting/BetSlip.tsx`
- Modify: `app/sports/[sport]/[matchId]/page.tsx`
- Delete: `lib/odds.ts`

**Interfaces:**
- Consumes: `projectedOdds`, `formatOdds`, `projectedReturn` from Task 2
- Produces: nothing

- [ ] **Step 1: Update `MarketsSection.tsx` imports and types**

Change line 6 from:

```ts
import { calculateOdds, formatOdds } from '@/lib/odds'
```

to:

```ts
import { projectedOdds, formatOdds } from '@/lib/parimutuel'
```

Change the `BetOption` type (lines 8-12) to:

```ts
type BetOption = {
  id: string
  label: string
  total_amount_bet: number
  seed_amount: number
}
```

- [ ] **Step 2: Use projected odds for each option**

In the option-rendering block, change:

```ts
                  const odds = calculateOdds(market.bet_options, option.id, 1, market.house_edge_pct)
```

to:

```ts
                  const odds = projectedOdds(market.bet_options, option.id, market.house_edge_pct)
```

- [ ] **Step 3: Label the odds as live rather than fixed**

Replace the odds paragraph:

```tsx
                      <p className={`text-lg font-bold mt-0.5 ${isWinner ? 'text-amber' : 'text-gold'}`}>
                        {formatOdds(odds)}
                      </p>
```

with:

```tsx
                      <p className={`text-lg font-bold mt-0.5 ${isWinner ? 'text-amber' : 'text-gold'}`}>
                        {formatOdds(odds)}
                        {market.status === 'open' && (
                          <span className="text-[10px] font-normal text-slate ml-1">live</span>
                        )}
                      </p>
```

- [ ] **Step 4: Keep the realtime handler seed-aware**

In the `bet_options` realtime subscription, replace:

```ts
              bet_options: market.bet_options.map((o) =>
                o.id === updated.id ? { ...o, total_amount_bet: updated.total_amount_bet } : o
              ),
```

with:

```ts
              bet_options: market.bet_options.map((o) =>
                o.id === updated.id
                  ? { ...o, total_amount_bet: updated.total_amount_bet, seed_amount: o.seed_amount }
                  : o
              ),
```

- [ ] **Step 5: Update `BetSlip.tsx`**

Change line 4 from:

```ts
import { calculateOdds, calcPayout, formatOdds } from '@/lib/odds'
```

to:

```ts
import { projectedOdds, projectedReturn, formatOdds } from '@/lib/parimutuel'
```

Change the `BetOption` type (lines 6-10) to:

```ts
type BetOption = {
  id: string
  label: string
  total_amount_bet: number
  seed_amount: number
}
```

Change the preview effect (lines 43-51) to:

```ts
  useEffect(() => {
    const num = parseFloat(amount)
    if (!isNaN(num) && num > 0) {
      setPreviewOdds(projectedOdds(market.bet_options, selectedOption.id, market.house_edge_pct, num))
    } else {
      setPreviewOdds(null)
    }
  }, [amount, market.bet_options, selectedOption.id, market.house_edge_pct])
```

- [ ] **Step 6: Tell the truth in the bet slip**

Replace the whole preview block (lines 136-151) with:

```tsx
      {previewOdds !== null && parseFloat(amount) > 0 && (
        <div className="bg-baize rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-slate">
            <span>Projected odds</span>
            <span className="text-gold font-bold">{formatOdds(previewOdds)}</span>
          </div>
          <div className="flex justify-between text-slate">
            <span>Stake</span>
            <span>₹{parseFloat(amount).toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between font-semibold text-white border-t border-rail pt-1 mt-1">
            <span>Projected return</span>
            <span className="text-amber">
              ~₹{projectedReturn(parseFloat(amount), previewOdds).toLocaleString('en-IN')}
            </span>
          </div>
          <p className="text-[11px] text-slate pt-1 leading-snug">
            Winners share the pool. Your final payout depends on how much is
            backing this option when the market closes, so this figure will move.
          </p>
        </div>
      )}
```

- [ ] **Step 7: Correct the early-bird copy**

Replace the early-bird banner text (line 100):

```tsx
          <span>Early bird! Bet now for a <strong>+10% bonus</strong> on your payout.</span>
```

with:

```tsx
          <span>Early bird! Bets in the first 30 min count as <strong>1.1×</strong> when the pool is shared out.</span>
```

- [ ] **Step 8: Select the seed column on the match page**

In `app/sports/[sport]/[matchId]/page.tsx`, change the match query select (line 18) from:

```ts
      .select('*, markets(*, bet_options(*))')
```

to:

```ts
      .select('*, markets(*, bet_options(id, label, total_amount_bet, seed_amount))')
```

- [ ] **Step 9: Delete the dead module and confirm no consumers remain**

```bash
git rm lib/odds.ts
grep -rn "lib/odds\|calculateOdds\|calcPayout" app components lib
```

Expected: no matches. If `app/dashboard/page.tsx` or `app/admin/ledger/page.tsx` still import it, they were only using `formatOdds` — repoint those imports to `@/lib/parimutuel`.

- [ ] **Step 10: Verify build and tests**

Run: `npm test && npm run build`
Expected: 20 tests pass, build succeeds

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: projected-odds UI, replacing locked-odds display"
```

---

## Task 8: End-to-end verification

**Files:**
- Create: `scripts/verify-parimutuel.mjs`

**Interfaces:**
- Consumes: everything above
- Produces: a repeatable pre-deploy gate

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-parimutuel.mjs`:

```js
/**
 * Post-deploy gate for the pari-mutuel rework. Exits non-zero on any failure.
 *   node scripts/verify-parimutuel.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) fail++
}

console.log('=== SCHEMA ===')
for (const [t, c] of [['markets', 'seed_amount'], ['bet_options', 'seed_amount']]) {
  const { error } = await sb.from(t).select(c).limit(1)
  check(`${t}.${c}`, !error, error?.message ?? '')
}

console.log('\n=== SEEDING ===')
const { data: open } = await sb.from('markets')
  .select('id, seed_amount, bet_options(seed_amount)').eq('status', 'open')
const unseeded = open.filter(m => (m.bet_options ?? []).some(o => Number(o.seed_amount) <= 0))
check('every open market has seeded options', unseeded.length === 0, `${unseeded.length} unseeded`)

console.log('\n=== DATA PRESERVED ===')
for (const [t, expect] of [['profiles', 17], ['bets', 179]]) {
  const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
  check(`${t} = ${expect}`, count === expect, `actual ${count}`)
}

console.log('\n=== NO SETTLED MARKET EVER OVERPAID ===')
const { data: settled } = await sb.from('markets')
  .select('id, bet_options(total_amount_bet, seed_amount), bets(payout, status)')
  .eq('status', 'settled')
let overpaid = 0
for (const m of settled ?? []) {
  const capacity = (m.bet_options ?? []).reduce((s, o) => s + Number(o.total_amount_bet) + Number(o.seed_amount), 0)
  const paid = (m.bets ?? []).reduce((s, b) => s + Number(b.payout ?? 0), 0)
  if (paid > capacity + 0.01) overpaid++
}
check('no settled market paid out more than it held', overpaid === 0, `${overpaid} overpaid`)

console.log(`\n${fail === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fail} CHECK(S) FAILED`}`)
process.exit(fail === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the full gate**

Run: `npm test && npm run build && node scripts/verify-parimutuel.mjs`
Expected: 20 tests pass, build succeeds, all checks pass

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-parimutuel.mjs
git commit -m "test: add pari-mutuel post-deploy verification gate"
```

---

## Manual smoke test

Automated checks cannot confirm the bettor-facing behaviour. After Task 8:

1. `npm run dev`, sign in, open a seeded football fixture.
2. Confirm each option shows a sane opening price near **1.90x** — not 0.95x or a four-figure number.
3. Place a ₹100 bet. Confirm the slip says **"Projected return"** with a `~` and the explanatory line about the pool.
4. In a second browser, place ₹5000 on the same option. Confirm the first browser's odds drop live via realtime.
5. As admin, settle the market. Confirm both bettors are paid in proportion to stake and that the total paid is at most the pool.
6. Create a market, have exactly one person bet, settle it. Confirm it **voids and refunds** rather than paying out.

## Out of scope

Fantasy league (own plan), season-long standings, live in-play markets, rate limiting.

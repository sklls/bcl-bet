/**
 * Post-deploy gate for the pari-mutuel rework. Exits non-zero on any failure.
 *   node scripts/verify-parimutuel.mjs
 *
 * Beyond schema/seeding/preservation checks, this proves the specific
 * vulnerability migration 007 was written to close cannot be reproduced:
 * under the old engine, place_bet locked in odds_at_placement and
 * settle_market paid amount * odds_at_placement unconditionally. A stake on
 * a near-empty option could lock an enormous multiplier and then collect it
 * in full even after much more money piled onto the same side later — up to
 * ~95% of the pool from a single rupee (see EXPLOIT CLOSURE below).
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
// Generic over option count: one open market ("Man of the match") carries 28
// options at ~₹35.71 each, most carry 2 — never assume a fixed shape here.
const { data: open } = await sb.from('markets')
  .select('id, seed_amount, bet_options(seed_amount)').eq('status', 'open')
const unseeded = open.filter(m => (m.bet_options ?? []).some(o => Number(o.seed_amount) <= 0))
check('every open market has seeded options', unseeded.length === 0, `${unseeded.length} unseeded`)
check('open markets span more than one option count (sanity: filter is generic)',
  new Set(open.map(m => (m.bet_options ?? []).length)).size > 1,
  `option counts seen: ${[...new Set(open.map(m => (m.bet_options ?? []).length))].sort((a, b) => a - b).join(', ')}`)

console.log('\n=== DATA PRESERVED (real money, must be untouched) ===')
for (const [t, expect] of [['profiles', 17], ['bets', 179], ['transactions', 281]]) {
  const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
  check(`${t} = ${expect}`, count === expect, `actual ${count}`)
}
const { data: bal } = await sb.from('profiles').select('wallet_balance')
const walletTotal = bal.reduce((s, p) => s + Number(p.wallet_balance), 0)
check('total wallet balance = ₹160,978.30', Math.abs(walletTotal - 160978.30) < 0.01,
  `actual ₹${walletTotal.toFixed(2)}`)

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

console.log('\n=== EXPLOIT CLOSURE (odds_at_placement > 100) ===')
console.log('  The old engine locked odds_at_placement and paid amount * odds_at_placement')
console.log('  unconditionally (see supabase/migrations/001_schema.sql settle_market). That raw')
console.log('  product is therefore the true historical exploit payout — what a bettor was')
console.log('  unconditionally promised regardless of what happened to the pool afterwards.')
console.log('  (bets.payout itself is NOT used as the baseline: several of these markets were')
console.log('  actually settled through the live app after the Task 6/7 fix already shipped, so')
console.log('  their payout column already reflects the corrected engine, not the exploit.)')
console.log()

// ----------------------------------------------------------------------
// Inline mirror of settleMarket() from lib/parimutuel.ts.
//
// Why inline rather than importing the TS module or shelling out to vitest:
// this is a plain .mjs script (no ts-node/tsx in devDependencies) run
// directly with `node`, and duplicating the ~90-line pro-rata algorithm here
// keeps the gate a single dependency-free file consistent with verify.mjs
// and backfill-seeds.mjs. Every branch below is copied line-for-line from
// lib/parimutuel.ts (safeNum, optionTotal, poolTotal, betWeight,
// settleMarket) — if that file's algorithm changes, this copy must too.
// ----------------------------------------------------------------------
const safeNum = (x) => { const n = Number(x); return Number.isNaN(n) ? 0 : n }
const round2 = (n) => Math.round(n * 100) / 100
const optionTotal = (o) => safeNum(o.total_amount_bet) + safeNum(o.seed_amount)
const poolTotal = (options) => options.reduce((s, o) => s + optionTotal(o), 0)
const EARLY_BIRD_WINDOW_MS = 30 * 60 * 1000
const EARLY_BIRD_WEIGHT = 1.1
function betWeight(bet, marketCreatedAt) {
  const placed = new Date(bet.placed_at).getTime()
  const cutoff = new Date(marketCreatedAt).getTime() + EARLY_BIRD_WINDOW_MS
  return safeNum(bet.amount) * (placed < cutoff ? EARLY_BIRD_WEIGHT : 1)
}
function settleMarket({ options, bets, winningOptionId, houseEdgePct, marketCreatedAt }) {
  const refundAll = (reason) => ({
    kind: 'void', reason,
    refunds: bets.map((b) => ({ bet_id: b.id, user_id: b.user_id, amount: round2(safeNum(b.amount)) })),
  })
  const winners = bets.filter((b) => b.bet_option_id === winningOptionId)
  if (winners.length === 0) return refundAll('no_winning_bets')
  const optionsWithBets = new Set(bets.map((b) => b.bet_option_id))
  if (optionsWithBets.size < 2) return refundAll('single_sided')
  const betsTotal = bets.reduce((s, b) => s + safeNum(b.amount), 0)
  const seedTotal = options.reduce((s, o) => s + safeNum(o.seed_amount), 0)
  const pool = Math.max(poolTotal(options), betsTotal + seedTotal)
  const payoutPool = pool * (1 - houseEdgePct / 100)
  const winningOption = options.find((o) => o.id === winningOptionId)
  const seedOnWinner = winningOption ? safeNum(winningOption.seed_amount) : 0
  const weightedStakes = winners.map((b) => betWeight(b, marketCreatedAt))
  const totalWeight = weightedStakes.reduce((s, w) => s + w, 0) + seedOnWinner
  let payouts = winners.map((b, i) => ({
    bet_id: b.id, user_id: b.user_id,
    amount: round2(payoutPool * (weightedStakes[i] / totalWeight)),
  }))
  const floors = winners.map((b) => round2(safeNum(b.amount)))
  payouts = payouts.map((p, i) => ({ ...p, amount: Math.max(p.amount, floors[i]) }))
  const totalFloor = floors.reduce((s, f) => s + f, 0)
  const totalSurplus = payouts.reduce((s, p, i) => s + (p.amount - floors[i]), 0)
  if (totalFloor + totalSurplus > pool && totalSurplus > 0) {
    const scale = Math.max(0, (pool - totalFloor) / totalSurplus)
    const floor2 = (n) => Math.floor(n * 100) / 100
    payouts = payouts.map((p, i) => ({ ...p, amount: floors[i] + floor2((p.amount - floors[i]) * scale) }))
  }
  const paid = payouts.reduce((s, p) => s + p.amount, 0)
  return {
    kind: 'paid', payouts,
    losingBetIds: bets.filter((b) => b.bet_option_id !== winningOptionId).map((b) => b.id),
    houseTake: round2(pool - paid),
  }
}

// A bet only ever collected the exploit payout if it actually won — a lost
// bet at absurd odds never got paid under either engine, so it is not part
// of "reproducing the exploit."
const { data: exploitBets, error: exploitErr } = await sb.from('bets')
  .select('id, market_id, bet_option_id, user_id, amount, odds_at_placement, payout, placed_at, status')
  .gt('odds_at_placement', 100)
  .eq('status', 'won')

check('exploit-candidate query succeeded', !exploitErr, exploitErr?.message ?? '')

const rows = []
if (exploitBets?.length) {
  const marketIds = [...new Set(exploitBets.map((b) => b.market_id))]
  const { data: markets } = await sb.from('markets')
    .select('id, house_edge_pct, created_at').in('id', marketIds)
  const marketById = Object.fromEntries((markets ?? []).map((m) => [m.id, m]))

  for (const b of exploitBets) {
    const market = marketById[b.market_id]
    const { data: options } = await sb.from('bet_options')
      .select('id, total_amount_bet, seed_amount').eq('market_id', b.market_id)
    const { data: allBets } = await sb.from('bets')
      .select('id, user_id, bet_option_id, amount, placed_at').eq('market_id', b.market_id)

    const result = settleMarket({
      options, bets: allBets,
      winningOptionId: b.bet_option_id,
      houseEdgePct: Number(market.house_edge_pct),
      marketCreatedAt: market.created_at,
    })
    const recomputed = result.kind === 'void'
      ? (result.refunds.find((r) => r.bet_id === b.id)?.amount ?? safeNum(b.amount))
      : (result.payouts.find((p) => p.bet_id === b.id)?.amount ?? 0)

    rows.push({
      bet_id: b.id,
      stake: safeNum(b.amount),
      odds: safeNum(b.odds_at_placement),
      oldEnginePayout: round2(safeNum(b.amount) * safeNum(b.odds_at_placement)),
      dbPayout: safeNum(b.payout),
      newEnginePayout: recomputed,
    })
  }
}

check(`found exploit-shaped bets to test (odds_at_placement > 100, won)`, rows.length > 0, `${rows.length} found`)

console.log()
console.log('  stake   old-engine (amt*odds)   new-engine today   reduction')
for (const r of rows.sort((a, b) => b.oldEnginePayout - a.oldEnginePayout)) {
  const reduction = r.oldEnginePayout > 0 ? (1 - r.newEnginePayout / r.oldEnginePayout) * 100 : 0
  console.log(
    `  ₹${String(r.stake).padEnd(6)} ₹${r.oldEnginePayout.toFixed(2).padEnd(22)} ₹${r.newEnginePayout.toFixed(2).padEnd(17)} ${reduction.toFixed(1)}%`
  )
}
console.log()

// Invariant 1: the new engine must never pay MORE than the old engine's
// unconditional locked-odds promise on any of these bets — it can only ever
// hold back money the old engine would have handed out, never exceed it.
const neverExceeds = rows.every((r) => r.newEnginePayout <= r.oldEnginePayout + 0.01)
check('new engine never pays more than the old locked-odds promise, on any flagged bet', neverExceeds,
  neverExceeds ? '' : `${rows.filter((r) => r.newEnginePayout > r.oldEnginePayout + 0.01).length} exceeded it`)

// Invariant 2: the worst real exploit instance — the largest unconditional
// promise the old engine made — collapses dramatically under the new engine.
// This is the ₹1-at-5700.95x case named in migration 007's own comment.
const worst = rows.reduce((a, b) => (b.oldEnginePayout > a.oldEnginePayout ? b : a), rows[0] ?? null)
if (worst) {
  const dramatic = worst.newEnginePayout < worst.oldEnginePayout * 0.05
  check(
    `worst exploit promise collapses by >=95% under the new engine`,
    dramatic,
    `₹${worst.stake} stake: old engine owed ₹${worst.oldEnginePayout.toFixed(2)} (${worst.odds}x) -> new engine pays ₹${worst.newEnginePayout.toFixed(2)} today`
  )
} else {
  check('worst exploit promise collapses by >=95% under the new engine', false, 'no exploit-shaped bets found to test')
}

console.log(`\n${fail === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fail} CHECK(S) FAILED`}`)
process.exit(fail === 0 ? 0 : 1)

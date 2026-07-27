import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) fail++
}

console.log('=== DATA PRESERVED (nothing was cleared) ===')
// Baseline rebased 2026-07-27: a real ₹50 bet was placed on 2026-07-26, which
// the previous numbers (179/281) predated. Wallet total moved ₹160,978.30 →
// ₹160,928.30 by that stake. Fantasy smoke-test rows were removed and left no
// trace — see scripts/verify-fantasy.mjs for the fantasy-side gate.
for (const [t, expect] of [['profiles', 17], ['bets', 180], ['transactions', 282]]) {
  const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
  check(`${t} = ${expect}`, count === expect, `actual ${count}`)
}
const { data: bal } = await sb.from('profiles').select('wallet_balance')
const total = bal.reduce((s, p) => s + Number(p.wallet_balance), 0)
check('wallets untouched', total > 100000, `₹${total.toFixed(2)} across 17 accounts`)

console.log('\n=== SCHEMA ===')
for (const [label, q] of [
  ['matches.format', sb.from('matches').select('format').limit(1)],
  ['teams.category', sb.from('teams').select('category').limit(1)],
  ['team_players.rating', sb.from('team_players').select('rating').limit(1)],
  ['team_players.credits', sb.from('team_players').select('credits').limit(1)],
]) {
  const { error } = await q
  check(label, !error, error?.message ?? '')
}
const { error: fkErr } = await sb.from('teams').select('name, team_players(name)').limit(1)
check('teams -> team_players FK (fixes /api/admin/players)', !fkErr, fkErr?.message ?? '')

console.log('\n=== SEEDED DATA ===')
const { data: teams } = await sb.from('teams').select('id, name, sport, category')
const { data: tps } = await sb.from('team_players').select('team_id, rating, credits')
const { data: matches } = await sb.from('matches').select('sport, format, status')
const { data: markets } = await sb.from('markets').select('status')

const active = teams.filter(t => t.category === 'mens')
const placeholder = teams.filter(t => t.category === 'unassigned')
check('36 active teams (6 sports x 6 houses)', active.length === 36, `${active.length} active`)
check('6 placeholder teams holding former orphans', placeholder.length === 6, `${placeholder.length} unassigned`)
check('no orphaned players', tps.every(p => teams.some(t => t.id === p.team_id)),
  `${tps.filter(p => !teams.some(t => t.id === p.team_id)).length} orphans`)
check('every player rated 1-10', tps.every(p => p.rating >= 1 && p.rating <= 10))
check('credits = 6 + rating*0.5', tps.every(p => Math.abs(Number(p.credits) - (6 + p.rating * 0.5)) < 0.01))

const singles = matches.filter(m => m.format === 'singles').length
const doubles = matches.filter(m => m.format === 'doubles').length
check('TT/Pool singles + doubles', singles === 4 && doubles === 2, `${singles} singles, ${doubles} doubles`)
check('26 new open markets', markets.filter(m => m.status === 'open').length === 27,
  `${markets.filter(m => m.status === 'open').length} open (26 new + 1 pre-existing)`)

console.log('\n=== FANTASY BUDGET (100 credits, XI of 11) ===')
const { data: fixtures } = await sb.from('matches')
  .select('sport, team_a, team_b').eq('status', 'upcoming').in('sport', ['cricket', 'football'])
let allBite = true
for (const m of fixtures) {
  const { data: two } = await sb.from('teams').select('team_players(credits)')
    .in('name', [m.team_a, m.team_b]).eq('sport', m.sport).eq('category', 'mens')
  const pool = two.flatMap(t => t.team_players).map(p => Number(p.credits)).sort((a, b) => b - a)
  if (pool.length < 11) continue
  const top = pool.slice(0, 11).reduce((s, c) => s + c, 0)
  const bot = pool.slice(-11).reduce((s, c) => s + c, 0)
  if (!(top > 100 && bot < 100)) allBite = false
}
check(`all ${fixtures.length} cricket/football fixtures force a trade-off`, allBite)

console.log(`\n${fail === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fail} CHECK(S) FAILED`}`)
process.exit(fail === 0 ? 0 : 1)

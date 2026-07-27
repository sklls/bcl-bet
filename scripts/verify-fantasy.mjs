/**
 * Post-deploy gate for the fantasy league.
 *
 * Proves three things the unit tests cannot: the schema is actually deployed,
 * the money-moving RPCs are unreachable with the public anon key, and no
 * settled contest has paid out more than the pool it drew from.
 *
 *   node scripts/verify-fantasy.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const sb   = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) fail++
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

console.log('=== SCHEMA ===')
for (const t of ['contests', 'contest_entries', 'entry_players', 'player_match_stats']) {
  const { error } = await sb.from(t).select('*').limit(1)
  check(`${t} exists and is selectable`, !error, error?.message ?? '')
}

console.log('\n=== RPC LOCKDOWN (anon must be refused) ===')
{
  const { error } = await anon.rpc('enter_contest', {
    p_user_id: ZERO_UUID, p_contest_id: ZERO_UUID,
    p_player_ids: Array(11).fill(ZERO_UUID),
    p_captain_id: ZERO_UUID, p_vice_captain_id: ZERO_UUID,
  })
  check('enter_contest rejects the anon key', !!error, error ? `${error.code}: ${error.message}` : 'NO ERROR — EXPOSED')
}
{
  const { error } = await anon.rpc('settle_contest', {
    p_contest_id: ZERO_UUID, p_awards: [], p_void: false,
  })
  check('settle_contest rejects the anon key', !!error, error ? `${error.code}: ${error.message}` : 'NO ERROR — EXPOSED')
}
{
  // The mirror image: service_role must still be able to call them, or the
  // REVOKE went too far. A missing contest is the *business* error.
  const { error } = await sb.rpc('settle_contest', {
    p_contest_id: ZERO_UUID, p_awards: [], p_void: false,
  })
  const businessError = error?.code === 'P0001'
  check('settle_contest still executes for service_role', businessError,
    error ? `${error.code}: ${error.message}` : 'no error at all')
}

console.log('\n=== RLS ===')
{
  const { data, error } = await anon.from('contest_entries').select('id, user_id')
  check('anon reads no contest entries', (data ?? []).length === 0,
    error ? `${error.code}: ${error.message}` : `${(data ?? []).length} rows visible`)
}

console.log('\n=== SOLVENCY ===')
const { data: contests } = await sb.from('contests').select('id, entry_fee, house_edge_pct, prize_pool, status')
const { data: entries }  = await sb.from('contest_entries').select('id, contest_id, payout')

let overpaid = 0, oversubscribed = 0
for (const c of contests ?? []) {
  const mine = (entries ?? []).filter(e => e.contest_id === c.id)
  const paid = mine.reduce((s, e) => s + Number(e.payout ?? 0), 0)
  const pool = Number(c.prize_pool)

  if (c.status === 'settled' && paid > pool + 0.01) overpaid++

  // The pool is fees x (1 - edge). More entrants than the pool implies means
  // a fee was charged that never reached the pool.
  const fee  = Number(c.entry_fee)
  const rate = 1 - Number(c.house_edge_pct) / 100
  if (fee > 0) {
    const implied = pool / fee / rate
    if (mine.length > implied + 0.01) oversubscribed++
  }
}
check(`every settled contest paid within its pool`, overpaid === 0, `${overpaid} over-paid`)
check(`no contest has more entrants than its pool implies`, oversubscribed === 0, `${oversubscribed} mismatched`)

const { data: lineups } = await sb.from('entry_players').select('entry_id')
const perEntry = {}
for (const r of lineups ?? []) perEntry[r.entry_id] = (perEntry[r.entry_id] ?? 0) + 1
const badLineups = (entries ?? []).filter(e => (perEntry[e.id] ?? 0) !== 11)
check('every entry holds exactly 11 players', badLineups.length === 0,
  `${badLineups.length} of ${(entries ?? []).length} entries malformed`)

console.log('\n=== PRODUCTION DATA UNCHANGED ===')
const { count: profileCount } = await sb.from('profiles').select('*', { count: 'exact', head: true })
check('profiles = 17', profileCount === 17, `actual ${profileCount}`)

const { data: bal } = await sb.from('profiles').select('wallet_balance')
const total = (bal ?? []).reduce((s, p) => s + Number(p.wallet_balance), 0)
check('wallets intact', total > 100000, `₹${total.toFixed(2)} across ${profileCount} accounts`)

console.log(`\n${fail === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fail} CHECK(S) FAILED`}`)
process.exit(fail === 0 ? 0 : 1)

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

/**
 * Seed script — teams, squads, matches and sample betting markets.
 *
 * Cricket teams are recreated with their ORIGINAL uuids so the 139 existing
 * rows in team_players reattach automatically (there is no FK, so they were
 * orphaned when the teams table was last cleared).
 *
 * Every other sport gets dummy teams + squads. Idempotent: re-running replaces
 * only what this script created, and never touches bets or transactions.
 *
 *   node scripts/seed.mjs           # seed
 *   node scripts/seed.mjs --dry     # print plan, write nothing
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const DRY = process.argv.includes('--dry')

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── house names ──────────────────────────────────────────────────────────────
// BCL is one inter-house tournament, so the same six houses field a side in
// every team sport. Recovered cricket uuids are pinned to reattach squads.
const HOUSES = [
  { name: 'Skyhawks',    cricketId: '0d437c1c-7081-4460-a792-39882d8cca5a' },
  { name: 'Daredevils',  cricketId: 'd61a4a63-18a9-4133-84f6-7c3182a12e58' },
  { name: 'Strikers',    cricketId: 'fe96e9fd-86fd-4649-a9dd-2200d13fd067' },
  { name: 'Titans',      cricketId: '3774c3cf-c6bd-4a41-9aab-a1311cf1ec40' },
  { name: 'Super Kings', cricketId: '299e16cc-0142-4cf6-a5e5-f6bc02602adf' },
  { name: 'Spartans',    cricketId: '2ade2414-3c4f-4c70-a97c-06dd3d3989c6' },
]

// ── deterministic dummy names ────────────────────────────────────────────────
const FIRST = ['Aarav','Vivaan','Aditya','Vihaan','Arjun','Reyansh','Krishna','Ishaan',
  'Rohan','Kabir','Aryan','Dhruv','Kunal','Nikhil','Rahul','Siddharth','Varun','Karan',
  'Manish','Pranav','Tushar','Yash','Sameer','Harsh','Ankit','Devansh','Om','Parth',
  'Rishi','Sarthak','Tanmay','Uday','Vikram','Neel','Gaurav','Jatin']
const LAST = ['Sharma','Verma','Patel','Reddy','Nair','Iyer','Mehta','Kulkarni','Joshi',
  'Desai','Gupta','Malhotra','Chopra','Bansal','Rao','Pillai','Shetty','Bhat','Kapoor',
  'Sinha','Ghosh','Banerjee','Chauhan','Yadav','Mishra','Tiwari','Saxena','Agarwal']

// simple LCG so runs are reproducible
let _s = 20260725
const rnd = () => (_s = (_s * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = a => a[Math.floor(rnd() * a.length)]

const usedNames = new Set()
function playerName() {
  for (let i = 0; i < 200; i++) {
    const n = `${pick(FIRST)} ${pick(LAST)}`
    if (!usedNames.has(n)) { usedNames.add(n); return n }
  }
  return `${pick(FIRST)} ${pick(LAST)} ${usedNames.size}`
}

// ── squad shapes ─────────────────────────────────────────────────────────────
// football gets real positions (cheap + obvious). other sports use generic roles.
const SQUADS = {
  football:   [['GK',2],['DEF',5],['MID',5],['FWD',2]],           // 14
  basketball: [['Guard',4],['Forward',4],['Center',2]],           // 10
  volleyball: [['Setter',2],['Hitter',4],['Blocker',2],['Libero',1]], // 9
  table_tennis: [['Singles',4]],                                  // 4
  pool:         [['Singles',4]],                                  // 4
}

const rating = () => 3 + Math.floor(rnd() * 8)   // 3–10

// ── plan ─────────────────────────────────────────────────────────────────────
const teamRows = []
const playerRows = []

for (const h of HOUSES) {
  teamRows.push({ id: h.cricketId, name: h.name, sport: 'cricket' })  // squads reattach
}
for (const sport of Object.keys(SQUADS)) {
  for (const h of HOUSES) {
    const id = crypto.randomUUID()
    teamRows.push({ id, name: h.name, sport })
    for (const [role, n] of SQUADS[sport]) {
      for (let i = 0; i < n; i++) {
        playerRows.push({ team_id: id, name: playerName(), role, bid_amount: rating() })
      }
    }
  }
}

// ── matches ──────────────────────────────────────────────────────────────────
const day = n => new Date(Date.UTC(2026, 7, n, 16, 45)).toISOString()
const VENUES = ['Main Ground','Astro Turf','Indoor Court','Sports Complex','Rec Room']

// for singles/doubles sports team_a/team_b hold the player or pair name.
// (matches.format lands in migration 003 — until then the sport implies it.)
const matchPlan = [
  ['football',   'Titans',      'Daredevils',  day(3)],
  ['football',   'Skyhawks',    'Strikers',    day(5)],
  ['football',   'Super Kings', 'Spartans',    day(7)],
  ['basketball', 'Skyhawks',    'Titans',      day(4)],
  ['basketball', 'Strikers',    'Super Kings', day(8)],
  ['volleyball', 'Spartans',    'Daredevils',  day(6)],
  ['volleyball', 'Titans',      'Skyhawks',    day(9)],
]

const seedMarkets = []   // { matchKey, market_type, title, options[] }

function winnerMarket(a, b) {
  return { market_type: 'winner', title: 'Match Winner', options: [a, b] }
}

const MARKETS_BY_SPORT = {
  football:   m => [winnerMarket(m.team_a, m.team_b),
                    { market_type: 'over_under', title: 'Total Goals', options: ['Over 2.5', 'Under 2.5'] }],
  basketball: m => [winnerMarket(m.team_a, m.team_b),
                    { market_type: 'over_under', title: 'Total Points', options: ['Over 120.5', 'Under 120.5'] }],
  volleyball: m => [winnerMarket(m.team_a, m.team_b),
                    { market_type: 'set_winner', title: 'First Set Winner', options: [m.team_a, m.team_b] }],
  table_tennis: m => [winnerMarket(m.team_a, m.team_b),
                      { market_type: 'handicap', title: 'Handicap (−1.5 sets)', options: [`${m.team_a} −1.5`, `${m.team_b} +1.5`] }],
  pool:       m => [winnerMarket(m.team_a, m.team_b),
                    { market_type: 'frame_handicap', title: 'Frame Handicap', options: [`${m.team_a} −2.5`, `${m.team_b} +2.5`] }],
  cricket:    m => [winnerMarket(m.team_a, m.team_b),
                    { market_type: 'over_under', title: 'Total Score of Both Teams', options: ['Over 250.5', 'Under 250.5'] }],
}

async function main() {
  console.log(`${DRY ? 'DRY RUN — ' : ''}seeding\n`)

  // individual-sport matches need player names, so build after squads exist
  const ttPlayers = {}, poolPlayers = {}
  for (const h of HOUSES) {
    const tt = playerRows.filter(p => p.role === 'Singles')
    // partition happens after insert; placeholder resolved below
  }

  console.log(`teams   : ${teamRows.length}  (6 cricket pinned + ${teamRows.length - 6} new)`)
  console.log(`players : ${playerRows.length} new dummy players`)
  console.log(`matches : ${matchPlan.length} team-sport + 6 individual`)

  if (DRY) {
    for (const t of teamRows) console.log(`  team   ${t.sport.padEnd(13)} ${t.name}`)
    return
  }

  // 1. teams — upsert so reruns are safe
  const { error: tErr } = await sb.from('teams').upsert(teamRows, { onConflict: 'id' })
  if (tErr) throw new Error('teams: ' + tErr.message)
  console.log('\n✓ teams upserted')

  // 2. squads for non-cricket sports (cricket squads already exist)
  const newTeamIds = teamRows.filter(t => t.sport !== 'cricket').map(t => t.id)
  await sb.from('team_players').delete().in('team_id', newTeamIds)
  const { error: pErr } = await sb.from('team_players').insert(playerRows)
  if (pErr) throw new Error('team_players: ' + pErr.message)
  console.log(`✓ ${playerRows.length} squad players inserted`)

  // 3. individual-sport matches from the seeded squads
  const indiv = []
  for (const sport of ['table_tennis', 'pool']) {
    const ids = teamRows.filter(t => t.sport === sport).map(t => t.id)
    const roster = ids.map(id => playerRows.filter(p => p.team_id === id).map(p => p.name))
    indiv.push([sport, roster[0][0], roster[1][0], day(sport === 'pool' ? 10 : 11)])            // singles
    indiv.push([sport, roster[2][0], roster[3][0], day(sport === 'pool' ? 12 : 13)])            // singles
    indiv.push([sport, `${roster[0][1]} / ${roster[0][2]}`, `${roster[1][1]} / ${roster[1][2]}`, day(sport === 'pool' ? 14 : 15)]) // doubles
  }

  const allMatches = [...matchPlan, ...indiv].map(([sport, a, b, d]) => ({
    sport, team_a: a, team_b: b, match_date: d,
    venue: VENUES[Math.floor(rnd() * VENUES.length)], status: 'upcoming',
  }))

  const { data: inserted, error: mErr } = await sb.from('matches').insert(allMatches).select()
  if (mErr) throw new Error('matches: ' + mErr.message)
  console.log(`✓ ${inserted.length} matches inserted`)

  // 4. sample betting markets, open for business
  let mkCount = 0, optCount = 0
  for (const m of inserted) {
    for (const spec of MARKETS_BY_SPORT[m.sport](m)) {
      const { data: mk, error } = await sb.from('markets').insert({
        match_id: m.id, market_type: spec.market_type, title: spec.title,
        status: 'open', house_edge_pct: 5.0, total_pool: 0,
      }).select().single()
      if (error) throw new Error('markets: ' + error.message)
      mkCount++
      const opts = spec.options.map(label => ({ market_id: mk.id, label, total_amount_bet: 0 }))
      const { error: oErr } = await sb.from('bet_options').insert(opts)
      if (oErr) throw new Error('bet_options: ' + oErr.message)
      optCount += opts.length
    }
  }
  console.log(`✓ ${mkCount} markets, ${optCount} bet options — all OPEN`)

  console.log('\n--- summary ---')
  for (const t of ['teams', 'team_players', 'matches', 'markets', 'bet_options']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
    console.log(`  ${t.padEnd(14)} ${count}`)
  }
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })

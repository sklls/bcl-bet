# PrimeStake

> *Luck is for the Unprepared.*

A free-to-play, multi-sport prediction game built for a private tournament. Players spend **in-game credits (CR)** on pari-mutuel match markets or build a fantasy XI, then compete on a leaderboard — all in real time.

> **Credits are a scoring unit.** They are issued by an admin for use inside the tournament, cannot be purchased, and cannot be transferred out of the app or exchanged for anything outside it. Everything a player "wins" is credits returning to their in-game balance. PrimeStake is a way of keeping score in a private tournament.

---

## Two ways to play

| Mode | Route | How it works |
|---|---|---|
| **Betting** | `/sports/[sport]/betting` | Back an outcome on a market. Everyone's stake pools; winners share the pool in proportion to their stake, after a 5% house edge. |
| **Fantasy** | `/sports/[sport]/fantasy` | Pick an XI within a 100 squad-credit budget. Players score points from real match stats. Top ranks share the prize pool. |

Betting runs on all six sports. Fantasy is **cricket and football only** — the other four have no squad data to draw on.

---

## Features

### Betting
- **Pari-mutuel odds** — odds are derived from the pool, not set by a bookmaker; the more credits on one side, the lower its payout
- **Multiple market types** — Match Winner, Top Scorer, Over/Under, and custom Live markets
- **Early bird bonus** — +10% payout for bets placed within the first 30 minutes of a market opening
- **Show who's betting** — first names of bettors under each option, with early-bird highlights
- **Void and refund** — a market with only one side backed refunds every stake rather than paying out

### Fantasy
- **Squad building** — 11 players, 100 squad credits, at most 7 from one team
- **Captain 2× / vice-captain 1.5×** point multipliers
- **Football position quotas** — exactly 1 GK, 3–5 DEF, 3–5 MID, 1–3 FWD. Cricket has no quotas (its roles are auction tiers, not playing positions)
- **Five capturable stats per sport** — cricket: runs, wickets, catches, sixes, run-outs; football: goals, assists, saves, clean sheet, cards
- **Rank-based prizes** — 10+ entrants pay the top 5, 4–9 pay the top 3, under 4 voids and refunds
- **Private lineups** — nobody sees a rival's XI before the contest locks

### Shared
- **Live score integration** — scores pulled from CricHeroes automatically
- **Leaderboard** — overall rankings and per-match breakdowns
- **Admin dashboard** — matches, markets, contests, stat entry, credit issuance, financial overview
- **Transaction audit trail** — every credit movement is logged

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth |
| Validation | Zod |
| Testing | Vitest |
| Deployment | Vercel |
| Score Data | CricHeroes (scraped) |

---

## Project Structure

```
bcl-bet/
├── app/
│   ├── api/
│   │   ├── bets/                   # Place a bet
│   │   ├── settle/                 # Settle a market
│   │   ├── topup/                  # Admin credit issuance
│   │   ├── matches/                # List matches
│   │   ├── markets/[id]/           # Market bettors
│   │   ├── leaderboard/match/      # Match-specific leaderboard
│   │   ├── fantasy/
│   │   │   ├── squad/              # Selectable players for a fixture
│   │   │   ├── entry/              # Join a contest / edit a lineup
│   │   │   └── leaderboard/        # Contest standings (never a lineup)
│   │   ├── admin/
│   │   │   ├── contests/           # Create / update / delete a contest
│   │   │   └── fantasy/
│   │   │       ├── stats/          # Save match stats, recompute points
│   │   │       └── settle/         # Settle a contest, once
│   │   └── cron/sync-scores/       # Cron job for auto-sync
│   ├── admin/                      # Admin pages
│   ├── dashboard/                  # User dashboard
│   ├── leaderboard/                # Leaderboard (overall + per match)
│   ├── login/                      # Auth page
│   └── sports/[sport]/
│       ├── page.tsx                # Betting / Fantasy chooser
│       ├── betting/                # Match list
│       ├── [matchId]/              # Match detail + betting
│       └── fantasy/
│           ├── page.tsx            # Contest list
│           └── [matchId]/          # Team builder or leaderboard
├── components/
│   ├── admin/                      # FinancialOverview, StatEntry
│   ├── betting/                    # BetSlip, MarketsSection
│   ├── fantasy/                    # TeamBuilder, ContestLeaderboard
│   └── ui/                         # Navbar and shared UI
├── lib/
│   ├── credits.ts                  # The credit unit — format it nowhere else
│   ├── parimutuel.ts               # Pari-mutuel odds + settlement engine
│   ├── sports.ts                   # Sport registry, fantasy predicate
│   ├── fantasy/
│   │   ├── scoring.ts              # Stats → points
│   │   ├── lineup.ts               # Budget, team cap, position quotas
│   │   ├── prizes.ts               # Ranking, ties, prize distribution
│   │   └── squad.ts                # Server-side squad resolution
│   ├── supabase.ts                 # Browser Supabase client
│   └── supabase-server.ts          # Server + admin Supabase clients
├── scripts/
│   ├── apply-migration.mjs         # Apply a .sql file via the Management API
│   ├── verify.mjs                  # Baseline data gate
│   ├── verify-parimutuel.mjs       # Betting solvency gate
│   └── verify-fantasy.mjs          # Fantasy schema + lockdown + solvency gate
└── supabase/migrations/            # 001 → 011
```

---

## Database Schema

### Betting
- **`profiles`** — user accounts, credit balance, role (user/admin)
- **`matches`** — fixtures across six sports, with live score fields
- **`markets`** — betting markets per match
- **`bet_options`** — options within a market
- **`bets`** — individual bets with odds snapshot and payout
- **`transactions`** — full audit log of every credit movement

### Fantasy
- **`contests`** — one per match; entry fee, house edge, prize pool, lock time, status
- **`contest_entries`** — one per user per contest; captain, vice-captain, points, rank, payout
- **`entry_players`** — the 11 rows that make up a lineup
- **`player_match_stats`** — the five capturable stats per player per match
- **`team_players`** — squad roster with `rating` and a generated `credits` price

### Functions

Every credit-moving function is `SECURITY DEFINER`, and every one is `REVOKE`d from `PUBLIC`/`anon`/`authenticated` and granted only to `service_role`.

- **`place_bet()`** — atomic bet placement with balance deduction and pool update
- **`apply_settlement()`** — one-time market settlement, guarded by a row lock
- **`topup_wallet()`** — admin credit issuance with transaction log
- **`enter_contest()`** — join a contest or replace a lineup; charges the fee only on first entry
- **`settle_contest()`** — one-time contest settlement; caps payouts at the pool

---

## Odds System

PrimeStake uses **pari-mutuel odds** — the same system used by horse racing and state lotteries. No bookmaker sets a price; the pool does.

```
odds   = (total_pool / amount_on_this_option) × (1 − house_edge%)
payout = stake × odds
```

- Odds update in real time as more bets come in
- House edge is 5% by default, configurable per market
- Minimum odds 1.01×, so a bet is never worthless
- Odds shown include the player's own stake in the pool
- A market where only one option attracted a stake is **void** — every stake is refunded

### Early Bird Bonus

Bets placed within **30 minutes of a market opening** earn a **+10% payout bonus** at settlement, logged as `⚡ early bird +10%`.

---

## Fantasy Scoring

| Cricket | Points | | Football | Points |
|---|---|---|---|---|
| Appearance | 2 | | Appearance | 2 |
| Run | 1 | | Goal | 10 |
| Wicket | 25 | | Assist | 6 |
| Catch | 8 | | Save | 3 |
| Six (bonus) | 2 | | Clean sheet | 6 |
| Run-out | 12 | | Yellow / Red | −2 / −6 |

Captain scores **2×**, vice-captain **1.5×**. A player who did not play scores zero regardless of stats.

### Prize Splits

| Entrants | Split |
|---|---|
| 10 or more | 40 / 25 / 15 / 12 / 8 % |
| 4 – 9 | 50 / 30 / 20 % |
| Under 4 | Void — every entry refunded in full |

Ties share the combined prize for the places they occupy, and awards are rounded **down** to the paisa so the total is provably within the pool.

### Settlement is two separate actions

This is deliberate, and it is the one thing to understand before running a contest:

- **Save stats** — fully idempotent, moves no credits. Recomputes points and can be repeated as often as needed.
- **Settle contest** — one-time, guarded by a row lock and a status check. Pays out, then marks the contest settled. Refuses a second attempt.

Recomputing payouts after credits have moved is a double-credit bug. Saving stats never touches balances.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project
- Vercel account (for deployment)

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CRON_SECRET=your_cron_secret
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# only needed to run scripts/apply-migration.mjs
SUPABASE_ACCESS_TOKEN=your_personal_access_token
```

### Database Setup

Apply the migrations **in order** — `009` must land before `010`, because Postgres will not let a transaction use an enum value it added itself:

```bash
node scripts/apply-migration.mjs supabase/migrations/001_schema.sql
# ... through ...
node scripts/apply-migration.mjs supabase/migrations/011_fantasy_rpcs.sql
```

Then promote the first admin manually:
```sql
UPDATE profiles SET role = 'admin' WHERE id = 'your-user-uuid';
```

### Run Locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

### Verify

```bash
npm test                              # unit tests — scoring, lineup, prizes, pari-mutuel
npm run build                         # typecheck + build
node scripts/verify.mjs               # baseline data intact
node scripts/verify-parimutuel.mjs    # no settled market ever overpaid
node scripts/verify-fantasy.mjs       # fantasy schema, RPC lockdown, solvency
```

All five should exit 0.

---

## Admin Guide

| Task | Where |
|---|---|
| Create a match | `/admin/matches` |
| Add markets to a match | `/admin/matches` → expand match |
| Create a fantasy contest | `/admin/matches` → 🏆 Fantasy block (cricket/football rows only) |
| Enter match stats | `/admin/matches` → Enter stats |
| Settle a contest | `/admin/matches` → Settle contest |
| Issue credits to a player | `/admin/users` |
| Settle a market | `/admin/matches` → market row → Settle |
| View financial overview | `/admin` |
| View all transactions | `/admin/ledger` |

A contest cannot be settled until it has locked **and** every entry has points. Settling before stats are saved would rank everyone at zero and pay the wrong players.

---

## Deployment

Deployed on **Vercel**. A cron job runs daily at midnight to sync live scores and auto-settle completed matches.

```json
{
  "crons": [
    { "path": "/api/cron/sync-scores", "schedule": "0 0 * * *" }
  ]
}
```

---

## Security

- Row-Level Security on every table; lineups are readable only by their owner
- Admin API routes verify `role = 'admin'` server-side on every request
- The service role key is used server-side only, never exposed to the client
- Every `SECURITY DEFINER` function is revoked from `anon`/`authenticated` and granted only to `service_role`
- Bet placement and contest entry are atomic SQL transactions, guarded against race conditions and double-spending
- Lineups submitted by a client are re-validated server-side against a freshly resolved squad — the client's copy of the rules is a convenience, never the authority

---

## License

Private — internal use only.

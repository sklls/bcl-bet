# BPL Bet

A real-money cricket betting platform built for the **BCL (Business Cricket League)** tournament. Players can bet on live match markets using pari-mutuel odds, track their P&L, and compete on a leaderboard — all in real time.

---

## Features

- **Pari-mutuel odds** — odds calculated dynamically from the pool; the more money on one side, the lower the payout
- **Multiple market types** — Match Winner, Top Scorer, Over/Under, and custom Live markets
- **Early bird bonus** — +10% payout for bets placed within the first 30 minutes of a market opening
- **Show who's betting** — see first names of bettors under each option with early-bird highlights
- **Live score integration** — scores pulled from CricHeroes automatically
- **Auto-settlement** — markets auto-settle when CricHeroes reports match completion
- **Leaderboard** — overall rankings and per-match P&L breakdowns
- **Admin dashboard** — manage matches, markets, wallets, and view financial overview
- **Transaction audit trail** — every rupee movement is logged

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Deployment | Vercel |
| Score Data | CricHeroes (scraped) |

---

## Project Structure

```
bcl-bet/
├── app/
│   ├── api/                    # API routes
│   │   ├── bets/               # Place a bet
│   │   ├── settle/             # Settle a market
│   │   ├── topup/              # Admin wallet top-up
│   │   ├── cricheroes/         # Live score fetching
│   │   ├── matches/            # List matches
│   │   ├── markets/[id]/       # Market bettors
│   │   ├── leaderboard/match/  # Match-specific leaderboard
│   │   ├── admin/              # Admin endpoints (users, matches, markets)
│   │   └── cron/sync-scores/   # Cron job for auto-sync
│   ├── admin/                  # Admin pages
│   ├── dashboard/              # User dashboard
│   ├── leaderboard/            # Leaderboard (overall + per match)
│   ├── login/                  # Auth page
│   ├── matches/[id]/           # Match detail + betting
│   └── teams/                  # Teams listing
├── components/
│   ├── admin/                  # Admin UI components
│   ├── betting/                # BetSlip, MarketsSection, LiveScoreCard
│   └── ui/                     # Navbar and shared UI
├── lib/
│   ├── odds.ts                 # Pari-mutuel odds engine
│   ├── supabase.ts             # Browser Supabase client
│   └── supabase-server.ts      # Server + admin Supabase clients
└── supabase/
    └── migrations/
        ├── 001_schema.sql               # Full DB schema
        └── 002_early_bird_bonus.sql     # Early bird payout bonus
```

---

## Database Schema

### Core Tables

- **`profiles`** — user accounts, wallet balance, role (user/admin)
- **`matches`** — cricket matches with CricHeroes link and live score fields
- **`markets`** — betting markets per match (winner, top scorer, over/under, live)
- **`bet_options`** — options within a market (e.g., "Team A", "Team B")
- **`bets`** — individual user bets with odds snapshot and payout
- **`transactions`** — full audit log of all wallet movements
- **`players`** — player roster per match (used for top scorer market)

### Views & Functions

- **`leaderboard`** view — aggregates winnings and bet stats per user
- **`place_bet()`** RPC — atomic bet placement with wallet deduction and pool update
- **`settle_market()`** RPC — settles all bets, credits winners, applies early bird bonus
- **`topup_wallet()`** RPC — admin wallet top-up with transaction log

---

## Odds System

BPL Bet uses **pari-mutuel odds** — the same system used by horse racing and state lotteries.

```
odds = (total_pool / amount_on_this_option) * (1 - house_edge%)
payout = stake × odds
```

- Odds update in real time as more bets come in
- House edge is 5% by default (configurable per market)
- Minimum odds: 1.01× (bet is never worthless)
- Odds shown to the player include their own stake in the pool

---

## Early Bird Bonus

Bets placed within **30 minutes of a market opening** earn a **+10% payout bonus** at settlement. Applied inside the `settle_market()` SQL function and logged in the transaction description as `⚡ early bird +10%`.

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
```

### Database Setup

Run the migrations in order in the Supabase SQL editor:

1. `supabase/migrations/001_schema.sql` — full schema
2. `supabase/migrations/002_early_bird_bonus.sql` — early bird bonus update

Then promote the first admin manually:
```sql
UPDATE profiles SET role = 'admin' WHERE id = 'your-user-uuid';
```

### Run Locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

---

## Admin Guide

| Task | Where |
|---|---|
| Create a match | `/admin/matches` |
| Add markets to a match | `/admin/matches` → expand match |
| Top up a player's wallet | `/admin/users` |
| Settle a market | `/admin/matches` → market row → Settle |
| View financial overview | `/admin` |
| View all transactions | `/admin/ledger` |

---

## Deployment

The app is deployed on **Vercel**. A cron job runs daily at midnight (`0 0 * * *`) to sync live scores from CricHeroes and auto-settle completed matches.

```json
{
  "crons": [
    { "path": "/api/cron/sync-scores", "schedule": "0 0 * * *" }
  ]
}
```

---

## Security

- All routes protected by Supabase Row-Level Security (RLS)
- Admin API routes verify `role = 'admin'` server-side on every request
- Service role key is only used server-side, never exposed to the client
- Bet placement uses an atomic SQL transaction to prevent race conditions and double-spending

---

## License

Private — BCL internal use only.

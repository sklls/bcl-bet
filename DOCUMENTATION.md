# BCL Bet — Project Documentation

> **BCL Bet** is a pari-mutuel cricket tournament betting app built for the Bengaluru Cricket League (BCL). It allows participants to bet virtual currency on match outcomes, top scorers, and live events. Admins manage matches, markets, and wallets; users browse, bet, and track their results.

**Live URL:** https://bcl-bet-app-1.vercel.app
**Repository:** https://github.com/sklls/bcl-bet
**Stack:** Next.js 14 · Supabase (PostgreSQL + Auth) · Tailwind CSS · Vercel

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Variables](#4-environment-variables)
5. [Database Schema](#5-database-schema)
6. [Database Functions (RPCs)](#6-database-functions-rpcs)
7. [Row Level Security](#7-row-level-security)
8. [API Routes](#8-api-routes)
9. [Pages & Components](#9-pages--components)
10. [Authentication & Authorization](#10-authentication--authorization)
11. [Odds Calculation](#11-odds-calculation)
12. [Live Score Sync (CricHeroes)](#12-live-score-sync-cricheroes)
13. [Admin Workflows](#13-admin-workflows)
14. [User Workflows](#14-user-workflows)
15. [Deployment](#15-deployment)
16. [Local Development Setup](#16-local-development-setup)
17. [Known Limitations & Future Ideas](#17-known-limitations--future-ideas)

---

## 1. Project Overview

BCL Bet is a **closed betting platform** for a college cricket tournament. Real money is collected physically by admins, who then top-up user wallets on the platform. Users bet their virtual balance on match markets. Winners are credited automatically when a market is settled.

### Key Features

| Feature | Description |
|---|---|
| **Pari-mutuel betting** | Odds dynamically change as more bets come in (pool-based, not bookmaker-fixed) |
| **5% house edge** | Platform keeps 5% of every settled pool |
| **Market types** | Winner, Top Scorer, Over/Under, Live (custom) |
| **Admin panel** | Create matches & markets, settle results, manage wallets |
| **Live scores** | Auto-synced from CricHeroes every minute during live matches |
| **Auto-settlement** | Winner & top scorer markets auto-settle when match ends on CricHeroes |
| **Leaderboard** | Rankings by net profit across all users |
| **House edge tracking** | Admin dashboard shows total staked, paid out, and edge kept |
| **User stats** | Win rate %, net profit, ROI on personal dashboard |

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.35 |
| Language | TypeScript | ^5 |
| Database | Supabase (PostgreSQL) | ^2.97.0 |
| Auth | Supabase Auth (email/password) | — |
| Styling | Tailwind CSS | ^3.4.1 |
| Date formatting | date-fns | ^4.1.0 |
| Icons | lucide-react | ^0.575.0 |
| Validation | Zod | ^4.3.6 |
| Deployment | Vercel | — |

---

## 3. Project Structure

```
bcl-bet/
├── app/
│   ├── api/                          # API routes (server-side)
│   │   ├── bets/route.ts             # Place a bet (POST)
│   │   ├── settle/route.ts           # Settle a market (POST)
│   │   ├── topup/route.ts            # Top up wallet (POST)
│   │   ├── cricheroes/route.ts       # Fetch live scores from CricHeroes
│   │   ├── auth/callback/route.ts    # Auth OAuth callback
│   │   ├── cron/
│   │   │   └── sync-scores/route.ts  # Vercel Cron — sync live scores
│   │   └── admin/
│   │       ├── matches/route.ts      # CRUD matches (admin only)
│   │       ├── markets/route.ts      # CRUD markets (admin only)
│   │       ├── bets/route.ts         # Void individual bets (admin only)
│   │       ├── users/route.ts        # List users, reset wallets (admin only)
│   │       └── players/route.ts      # Fetch players by team name
│   │
│   ├── admin/                        # Admin UI pages
│   │   ├── page.tsx                  # Admin dashboard (stats + financials)
│   │   ├── matches/page.tsx          # Manage matches & markets
│   │   └── users/page.tsx            # Manage users & wallets
│   │
│   ├── dashboard/page.tsx            # User's bets, stats, transactions
│   ├── leaderboard/page.tsx          # Public leaderboard
│   ├── login/page.tsx                # Sign in / Create account
│   ├── matches/[id]/page.tsx         # Match detail + betting
│   ├── teams/page.tsx                # Teams page
│   ├── layout.tsx                    # Root layout with Navbar
│   └── page.tsx                      # Homepage — match list
│
├── components/
│   ├── ui/
│   │   └── Navbar.tsx                # Global navigation bar
│   └── betting/
│       ├── MarketsSection.tsx        # Markets list on match page
│       ├── BetSlip.tsx               # Bet placement form
│       └── LiveScoreCard.tsx         # Real-time score display
│
├── lib/
│   ├── supabase.ts                   # Browser Supabase client
│   ├── supabase-server.ts            # Server + Admin Supabase clients
│   └── odds.ts                       # Pari-mutuel odds logic
│
├── supabase/
│   └── migrations/
│       └── 001_schema.sql            # Full database schema
│
├── middleware.ts                     # Route protection (auth + role checks)
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json                       # Cron job config
```

---

## 4. Environment Variables

Create a `.env.local` file in the root with these values:

```env
# Supabase — exposed to browser (safe)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase — server only (never expose to browser)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Vercel Cron — must match vercel.json Authorization header
CRON_SECRET=your-cron-secret
```

> **Security note:** The service role key bypasses all RLS policies. It is only used in server-side API routes via `createAdminClient()`. Never import `supabase-server.ts` in client components.

---

## 5. Database Schema

### Enums

```sql
user_role:        'user' | 'admin'
match_status:     'upcoming' | 'live' | 'completed' | 'cancelled'
market_type:      'winner' | 'top_scorer' | 'over_under' | 'live'
market_status:    'open' | 'closed' | 'settled'
bet_status:       'pending' | 'won' | 'lost' | 'void'
transaction_type: 'bet' | 'win' | 'topup' | 'refund'
```

### Tables

#### `profiles`
One row per registered user. Linked to Supabase `auth.users`.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK, FK → auth.users) | Same as auth user ID |
| `role` | user_role | `'user'` or `'admin'` |
| `display_name` | TEXT | Shown on leaderboard & dashboard |
| `wallet_balance` | DECIMAL(12,2) | Current balance (≥ 0 enforced) |
| `created_at` | TIMESTAMPTZ | Account creation time |

#### `matches`

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `team_a` | TEXT | Home team name |
| `team_b` | TEXT | Away team name |
| `match_date` | TIMESTAMPTZ | Scheduled start time |
| `venue` | TEXT | Optional venue name |
| `status` | match_status | Current match state |
| `over_under_line` | DECIMAL(6,1) | Line for over/under market |
| `cricheroes_match_id` | TEXT | CricHeroes match ID (for score sync) |
| `cricheroes_slug` | TEXT | CricHeroes URL slug |
| `live_score_a/b` | TEXT | e.g. `"142/3"` |
| `live_overs_a/b` | TEXT | e.g. `"18.2"` |
| `live_crr` | TEXT | Current run rate |
| `live_rrr` | TEXT | Required run rate |

#### `markets`
One market = one type of bet for one match (e.g. "Winner of Match 3").

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `match_id` | UUID (FK → matches) | Cascades on match delete |
| `market_type` | market_type | Type of bet |
| `status` | market_status | Open = accepting bets |
| `result` | TEXT | Winning option label (set on settle) |
| `total_pool` | DECIMAL(12,2) | Sum of all bets in this market |
| `house_edge_pct` | DECIMAL(4,2) | Default 5.0% |

#### `bet_options`
The choices within a market (e.g. "Titans", "Daredevils" for a winner market).

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `market_id` | UUID (FK → markets) | Cascades on market delete |
| `label` | TEXT | Display name of the option |
| `total_amount_bet` | DECIMAL(12,2) | Sum of bets on this option |

#### `bets`

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → profiles) | Who placed the bet |
| `market_id` | UUID (FK → markets) | Which market |
| `bet_option_id` | UUID (FK → bet_options) | Which option they chose |
| `amount` | DECIMAL(10,2) | Stake amount (> 0) |
| `odds_at_placement` | DECIMAL(8,4) | Locked-in odds at time of bet |
| `status` | bet_status | Current status |
| `payout` | DECIMAL(12,2) | Credited amount (won bets only) |
| `placed_at` | TIMESTAMPTZ | When the bet was placed |
| `settled_at` | TIMESTAMPTZ | When the market was settled |

#### `transactions`
Full ledger of all money movements.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → profiles) | Who the transaction belongs to |
| `type` | transaction_type | Type of movement |
| `amount` | DECIMAL(12,2) | Positive = credit, Negative = debit |
| `description` | TEXT | Human-readable description |
| `reference_id` | UUID | Optional FK to related bet |

**Transaction types:**
- `bet` — deducted when a bet is placed (negative amount)
- `win` — credited when a bet is won (positive)
- `topup` — admin adds real money (positive)
- `refund` — bet voided / market deleted (positive)

#### `players`
Used for top scorer market auto-population.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `name` | TEXT | Player's name |
| `match_id` | UUID (FK → matches) | Which match they're playing |
| `team` | TEXT | Team name |

### Views

#### `leaderboard`
```sql
SELECT p.id, p.display_name, p.wallet_balance,
  COALESCE(stats.total_winnings, 0) AS total_winnings,
  COALESCE(stats.bets_won, 0) AS bets_won,
  COALESCE(stats.total_bets, 0) AS total_bets
FROM profiles p
LEFT JOIN (
  SELECT user_id,
    SUM(CASE WHEN status = 'won' THEN payout - amount ELSE 0 END) AS total_winnings,
    COUNT(CASE WHEN status = 'won' THEN 1 END) AS bets_won,
    COUNT(CASE WHEN status IN ('won','lost') THEN 1 END) AS total_bets
  FROM bets GROUP BY user_id
) stats ON stats.user_id = p.id
ORDER BY total_winnings DESC;
```

> `total_winnings` = net profit (payout received minus stake), not gross payout.

### Indexes

```sql
idx_bets_user_id         ON bets(user_id)
idx_bets_market_id       ON bets(market_id)
idx_bets_status          ON bets(status)
idx_transactions_user_id ON transactions(user_id)
idx_markets_match_id     ON markets(match_id)
idx_bet_options_market_id ON bet_options(market_id)
```

### Cascade Deletes

```
matches → markets → bet_options → bets (all cascade on delete)
profiles → bets, transactions (cascade on delete)
```

---

## 6. Database Functions (RPCs)

All RPCs use `SECURITY DEFINER` and run with elevated privileges (bypass RLS).

### `handle_new_user()` — Trigger
Automatically creates a `profiles` row when a new user signs up.

```sql
-- Triggered: AFTER INSERT ON auth.users
-- Reads: raw_user_meta_data->>'full_name' or 'name' or email
-- Creates: profiles row with role = 'user'
```

### `place_bet(p_user_id, p_market_id, p_bet_option_id, p_amount, p_odds)`
Atomic bet placement in a single PostgreSQL transaction.

```
1. Lock profiles row (FOR UPDATE) → prevents double-spend
2. Check wallet_balance >= p_amount
3. Deduct p_amount from wallet
4. INSERT into bets
5. UPDATE bet_options.total_amount_bet += p_amount
6. UPDATE markets.total_pool += p_amount
7. INSERT into transactions (type='bet', amount=-p_amount)
RETURNS: JSON { bet_id }
```

### `settle_market(p_market_id, p_winning_option_id)`
Atomic market settlement.

```
FOR EACH winning bet:
  1. payout = bet.amount * bet.odds_at_placement
  2. UPDATE profiles.wallet_balance += payout
  3. UPDATE bets SET status='won', payout=payout
  4. INSERT into transactions (type='win', amount=payout)
THEN:
  5. UPDATE bets SET status='lost' WHERE bet_option_id != winning
  6. UPDATE markets SET status='settled', result=winning_label
```

### `topup_wallet(p_user_id, p_amount, p_description)`
Admin adds funds to a user's wallet.

```
1. UPDATE profiles.wallet_balance += p_amount
2. INSERT into transactions (type='topup', amount=p_amount)
```

### `reset_wallet(p_user_id, p_description)`
Admin zeroes out a user's wallet.

```
1. SELECT wallet_balance (current amount)
2. UPDATE profiles.wallet_balance = 0
3. INSERT into transactions (type='topup', amount=-current_balance)
```

---

## 7. Row Level Security

| Table | Policy |
|---|---|
| `profiles` | Users can SELECT/UPDATE own row; all authenticated users can SELECT (for leaderboard) |
| `matches` | Public read (no auth required) |
| `markets` | Public read |
| `bet_options` | Public read |
| `bets` | Users SELECT and INSERT only their own rows |
| `transactions` | Users SELECT only their own rows |
| `players` | Public read |

> **Admin operations** (create/delete/settle) are done through API routes using the **service role key**, which bypasses RLS entirely. The admin role check is enforced in the API handler code, not in RLS.

---

## 8. API Routes

### Public / User Routes

#### `POST /api/bets`
Place a bet on a market option.

**Request body:**
```json
{
  "market_id": "uuid",
  "bet_option_id": "uuid",
  "amount": 100
}
```

**Logic:**
1. Verify user is authenticated
2. Verify market is `open`
3. Calculate current odds server-side (pari-mutuel formula)
4. Call `place_bet()` RPC

**Response:** `{ success: true, bet_id: "uuid", odds: 2.45 }`

---

#### `GET /api/cricheroes?matchId=&slug=`
Scrapes live match data from CricHeroes.

**Response:**
```json
{
  "scoreA": "142/3",
  "scoreB": null,
  "oversA": "18.2",
  "oversB": null,
  "crr": "7.8",
  "rrr": "9.2",
  "status": "live",
  "result": null,
  "topBatters": ["Player A (45)", "Player B (32)"]
}
```

---

### Admin-Only Routes

All admin routes verify `profiles.role = 'admin'` before processing.

#### `GET /api/admin/matches`
Returns all matches with full nested data:
```
matches → markets → bet_options → bets → profiles(display_name)
```

#### `POST /api/admin/matches`
Create a new match.
```json
{
  "team_a": "Titans",
  "team_b": "Daredevils",
  "match_date": "2026-03-01T09:00:00Z",
  "venue": "BCL Ground",
  "cricheroes_url": "https://cricheroes.in/match/12345/some-slug"
}
```

#### `DELETE /api/admin/matches?id=`
Delete a match. Before deleting:
1. Finds all `pending` bets under this match's markets
2. Refunds each via `topup_wallet()` RPC
3. Marks refunded bets as `void`
4. Deletes match (cascades to markets, bet_options, bets)

---

#### `POST /api/admin/markets`
Create a market for a match.
```json
{
  "match_id": "uuid",
  "market_type": "winner",
  "options": ["Titans", "Daredevils"]
}
```

#### `PATCH /api/admin/markets`
Update market status.
```json
{ "market_id": "uuid", "status": "open" }
```

#### `DELETE /api/admin/markets?id=`
Delete a market. Refunds pending bets first (same flow as match delete).

---

#### `DELETE /api/admin/bets?id=`
Void a single pending bet and refund the user.

---

#### `POST /api/settle`
Settle a market with a winner.
```json
{ "market_id": "uuid", "winning_option_id": "uuid" }
```
Calls `settle_market()` RPC.

---

#### `POST /api/topup`
Top up a user's wallet.
```json
{ "target_user_id": "uuid", "amount": 500, "description": "Cash collected" }
```

---

#### `GET /api/admin/users`
Returns all users: `id`, `display_name`, `wallet_balance`, `role`, `created_at`.

#### `DELETE /api/admin/users?id=`
Reset a user's wallet to ₹0. Calls `reset_wallet()` RPC.

---

#### `GET /api/admin/players?teams=Titans,Daredevils`
Returns players grouped by team name.
```json
{
  "Titans": ["Rohan Sharma", "Arjun Patel"],
  "Daredevils": ["Vikram Singh", "Amit Kumar"]
}
```

---

#### `GET /api/cron/sync-scores`
Called by Vercel Cron every minute. Requires `Authorization: Bearer {CRON_SECRET}` header.

**Logic:**
1. Fetch all `live` matches with a `cricheroes_match_id`
2. For each match, call CricHeroes scraper
3. Update live score fields in DB
4. If match result detected → auto-settle winner + top_scorer markets

---

## 9. Pages & Components

### Pages

| Route | Auth | Description |
|---|---|---|
| `/` | Public | Homepage: lists upcoming, live, and completed matches |
| `/login` | Redirect if logged in | Sign in / Create account form |
| `/matches/[id]` | Public | Match details, markets, live score |
| `/dashboard` | Required | User's bets, stats, transaction history |
| `/leaderboard` | Public | Rankings by net profit |
| `/teams` | Public | Teams listing |
| `/admin` | Admin only | Dashboard: stats + financial overview |
| `/admin/matches` | Admin only | Create/manage matches and markets |
| `/admin/users` | Admin only | Top up / reset user wallets |

### Components

#### `Navbar.tsx`
- Shows app logo, nav links
- Authenticated: shows Dashboard link + Sign Out
- Admin: shows Admin link
- Unauthenticated: shows Sign In link

#### `MarketsSection.tsx`
- Renders all open/closed/settled markets for a match
- Subscribes to Supabase Realtime for live odds updates
- Shows current odds for each option

#### `BetSlip.tsx`
- Bet placement form within a market
- Shows: option name, current odds, input amount, estimated payout
- Submits to `POST /api/bets`

#### `LiveScoreCard.tsx`
- Subscribes to Supabase Realtime on `matches` table
- Shows: score, overs, CRR, RRR for both teams
- Updates in real-time without page refresh

---

## 10. Authentication & Authorization

### Sign Up
1. User fills: **Display Name**, **Email**, **Password** (min 6 chars)
2. Supabase creates `auth.users` row
3. `handle_new_user` trigger fires → creates `profiles` row with `role = 'user'`
4. Email confirmation is **disabled** — user is logged in immediately

### Sign In
Standard email/password via Supabase Auth.

### Session Management
- Uses `@supabase/ssr` with cookie-based sessions
- `middleware.ts` refreshes session on every request
- Protected routes redirect to `/login` if unauthenticated

### Role-Based Access
```typescript
// middleware.ts checks:
// /admin/* → must be authenticated + role = 'admin'
// /dashboard/* → must be authenticated

// API routes additionally verify:
const { data: profile } = await admin.from('profiles')
  .select('role').eq('id', user.id).single()
if (profile?.role !== 'admin') return 403
```

### Promoting to Admin
Run this SQL in Supabase Dashboard:
```sql
UPDATE profiles SET role = 'admin' WHERE id = 'your-user-uuid';
```

---

## 11. Odds Calculation

BCL Bet uses **pari-mutuel odds** — odds are pool-based, not set by a bookmaker.

### Formula

```
odds = (totalPool / amountOnOption) × (1 - houseEdge%)
```

**Example:**
- Total pool: ₹1,000
- Bets on "Titans": ₹200
- House edge: 5%
- Odds = (1000 / 200) × 0.95 = **4.75x**

If you bet ₹100, payout = ₹475.

**Minimum odds:** 1.01x (bettor always gets at least their stake back).

### Key Properties
- Odds **decrease** as more people bet on the same option
- Odds **increase** on an option when the competing option gets more bets
- Odds are **locked at placement** — late bets don't affect already-placed bets
- House always keeps ~5% of the total pool regardless of outcome

### Implementation (`lib/odds.ts`)

```typescript
calculateOdds(options, selectedOptionId, newBetAmount, houseEdgePct)
formatOdds(odds: number): string   // "4.75x"
calcPayout(amount, odds): number   // amount * odds
```

---

## 12. Live Score Sync (CricHeroes)

### How It Works

1. Admin creates a match and pastes the CricHeroes URL
2. The app parses the URL to extract `cricheroes_match_id` and `cricheroes_slug`
3. When the match goes live, Vercel Cron calls `/api/cron/sync-scores` **every minute**
4. The cron handler fetches each live match's CricHeroes page
5. It extracts `__NEXT_DATA__` JSON embedded in the HTML
6. Scores, overs, CRR, RRR are written to the `matches` table
7. Supabase Realtime pushes the update to `LiveScoreCard` components

### Auto-Settlement
When CricHeroes reports a match result:
1. The cron job detects `status === 'past'` (match over)
2. Parses the winning team from the result string
3. Auto-settles the **winner** market (calls `settle_market()`)
4. Parses top batter from scorecard → auto-settles **top_scorer** market
5. Updates match status to `completed`

### CricHeroes URL Format
```
https://cricheroes.in/match/<match_id>/<slug>/scorecard
```

---

## 13. Admin Workflows

### Creating a Match
1. Go to `/admin/matches` → "Add Match"
2. Enter team names, date/time, venue
3. Optionally paste CricHeroes URL for score sync
4. Click Create → match appears with status `upcoming`

### Opening a Market
1. On the match card, click "Add Market"
2. Choose market type:
   - **Winner** → team names auto-filled as options
   - **Top Scorer** → player checkboxes auto-populated from team rosters
   - **Over/Under / Live** → custom text options
3. Click Create → market is created in `closed` state
4. Click "Open" to start accepting bets

### Settling a Market
1. Click "Settle" on a market
2. Select the winning option
3. Click Confirm → `settle_market()` RPC runs atomically:
   - Winners credited instantly
   - Losers marked lost
   - Market closed

### Managing Wallets
- Go to `/admin/users`
- **Top Up**: Enter amount → calls `topup_wallet()` RPC
- **Reset**: Zeroes balance → calls `reset_wallet()` RPC

### House Edge Dashboard
Go to `/admin` to see:
- **Total Cash Collected** — sum of all positive top-ups
- **Total Staked** — sum of all settled bets
- **Total Paid Out** — sum of all winner payouts
- **House Edge Kept** — staked minus paid out, shown as ₹ and %
- Visual payout rate bar

---

## 14. User Workflows

### Signing Up
1. Go to `/login` → "Create Account"
2. Enter Display Name, Email, Password
3. Account created instantly (no email confirmation)
4. Contact admin to get wallet topped up

### Placing a Bet
1. Browse matches on homepage
2. Click a match → view markets
3. Click an option (e.g. "Titans to win")
4. Enter stake amount → see live odds & estimated payout
5. Click "Place Bet" → deducted from wallet immediately

### Tracking Bets
Go to `/dashboard`:
- **Balance** — current wallet balance
- **Bets** — won / settled count (+ pending)
- **Win Rate** — % of settled bets won (green ≥50%, red <50%)
- **Net Profit** — total payout received minus total staked (±₹)
- **ROI** — return on investment %
- Full bet history with status, odds, payout
- Full transaction log (bets, wins, top-ups, refunds)

---

## 15. Deployment

### Vercel (Production)

The app is deployed on Vercel at `bcl-bet-app-1.vercel.app`.

**Environment variables** must be set in Vercel dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

### Vercel Cron Job

`vercel.json` configures the score sync cron:
```json
{
  "crons": [{
    "path": "/api/cron/sync-scores",
    "schedule": "* * * * *"
  }]
}
```

The cron runs every minute and requires:
```
Authorization: Bearer {CRON_SECRET}
```

### Supabase Settings (Production Checklist)

- [ ] "Confirm email" → **OFF** (users log in immediately after signup)
- [ ] Service role key added to Vercel environment variables
- [ ] `handle_new_user` trigger active (check in Database → Functions)
- [ ] Leaderboard view created (check in Database → Views)
- [ ] `reset_wallet` RPC created (check in Database → Functions)
- [ ] Realtime enabled for `matches`, `markets`, `bet_options` tables

---

## 16. Local Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/sklls/bcl-bet.git
cd bcl-bet

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 4. Run the schema in Supabase SQL Editor
# Copy-paste supabase/migrations/001_schema.sql

# 5. Promote yourself to admin
# In Supabase SQL Editor:
# UPDATE profiles SET role = 'admin' WHERE id = 'your-uuid';

# 6. Start dev server
npm run dev
# App runs at http://localhost:3000
```

### Supabase Client Files

**`lib/supabase.ts`** — Browser client (safe for `'use client'` components):
```typescript
import { createBrowserClient } from '@supabase/ssr'
export function createClient() { ... }
```

**`lib/supabase-server.ts`** — Server-only clients:
```typescript
// Cookie-based session (for server components & middleware)
export function createServerSupabaseClient() { ... }

// Admin client — bypasses RLS (API routes only)
export function createAdminClient() { ... }
```

---

## 17. Known Limitations & Future Ideas

### Current Limitations

- **Manual wallet top-ups only** — No payment gateway (Stripe, Razorpay). Admin collects cash and tops up manually.
- **CricHeroes scraping** — Live scores depend on scraping CricHeroes HTML. If their site structure changes, the scraper may break.
- **No password reset** — Users who forget their password need admin help (via Supabase Dashboard).
- **No betting limits** — Users can bet their entire wallet in one go. No max bet enforcement.
- **No bet cutoff** — Markets stay open until admin manually closes them. No auto-close X minutes before match.

### Potential Improvements

| Feature | Description |
|---|---|
| **Betting cutoff** | Auto-close markets N minutes before match start |
| **Match chat** | Comment section per match for predictions |
| **Push notifications** | Alert when user's market is settled |
| **Export reports** | CSV/Excel export of all bets and transactions |
| **Per-match house edge** | Configure house edge per market, not just global |
| **Combo/parlay bets** | Multi-match bets for higher odds |
| **Password reset** | Self-service password reset via email |
| **Admin audit log** | Track which admin did what and when |
| **User profile edit** | Allow users to change display name |
| **Bet history filters** | Filter bets by match, status, date on dashboard |

---

*Documentation generated for BCL Bet v1.0 — February 2026*

# PrimeStake — The Full Journey

A detailed account of how this platform was conceived, built, broken, fixed, and evolved from a blank Next.js repo into a fully functioning cricket betting system for the BCL tournament.

---

## The Idea

The BCL is an internal cricket tournament played among MBA students. Watching matches was fun, but we wanted people to have more skin in the game — not real gambling, but a fun virtual economy where everyone gets a starting wallet and bets with virtual rupees.

The goals were simple:
- Players should be able to bet on match outcomes
- Odds should reflect how confident people are (not fixed odds)
- There should be a leaderboard to track who's the best predictor
- An admin should be able to manage everything without touching the database directly

What started as "let's throw something together quickly" turned into a surprisingly deep engineering project.

---

## Chapter 1: Picking the Stack

### The Decision

We needed to move fast. The tournament was already underway. The constraints:
- No budget for a backend server
- Needs to work on mobile (players bet from their phones during matches)
- Admin should be non-technical enough to manage without SQL

We chose:
- **Next.js 14 (App Router)** — server components + API routes in one codebase, no separate backend
- **Supabase** — PostgreSQL with built-in auth, real-time subscriptions, and Row-Level Security
- **Tailwind CSS** — fast dark-mode UI without writing a single CSS file
- **Vercel** — zero-config deployment with cron job support

### What Almost Went Wrong

The App Router was relatively new. A lot of documentation online assumed the older Pages Router. We hit several early issues with how server components interact with client components, and how cookies work differently in server vs. client contexts.

Supabase has two clients — a browser-safe anon client and a service-role admin client. Getting them confused early caused several RLS (Row-Level Security) errors that looked like missing data but were actually permission issues.

---

## Chapter 2: The Database

### Designing the Schema

The most important design decision was the relationship between `markets` and `bet_options`. A market is a question ("Who will win?"). An option is an answer ("Team A", "Team B"). Bets are placed on options, not on markets.

This separation allowed us to support any number of options per market — important for the Top Scorer market which might have 10+ players.

```
matches → markets → bet_options ← bets ← users
```

### The Wallet Problem

Wallets needed to be safe. A user should never be able to bet more than their balance, and two simultaneous bets shouldn't be able to overdraw it.

We solved this with a Postgres RPC function `place_bet()` that:
1. Locks the user's row with `SELECT FOR UPDATE`
2. Checks balance
3. Deducts atomically
4. Inserts the bet
5. Updates the bet option's pool

All in one transaction. This made race conditions impossible at the database level, not just the application level.

### Row-Level Security

We used Supabase's RLS extensively so that the database itself enforces privacy:
- Users can only see their own bets and transactions
- Anyone can see matches, markets, and bet options (needed for odds display)
- Anyone can see all profiles (needed for the leaderboard)
- Admins bypass RLS using the service role key

Getting RLS right took iteration. The first version had policies that were too permissive or too restrictive. The "anon can't insert profiles on signup" bug wasted a few hours — turns out the auth trigger inserts the profile, but the trigger runs as the database owner, so RLS doesn't apply.

---

## Chapter 3: The Odds Engine

### Why Not Fixed Odds?

Fixed odds (like a bookmaker offers) require someone to set and manage prices, update them as money comes in, and take on liability risk. We had none of that infrastructure.

Pari-mutuel odds were the answer. The pool is split among winners. The house takes a percentage. Nobody sets prices — the market does.

```
odds = (total_pool / amount_on_option) × (1 − house_edge%)
payout = stake × odds
```

### The Preview Odds Problem

When a player enters a stake amount, the odds they see should include their own stake (since their bet will affect the pool). This sounds obvious but is easy to get wrong.

The `calculateOdds` function in `lib/odds.ts` takes an extra `extraAmount` parameter representing the stake being previewed. This way, the displayed payout is accurate — not an optimistic pre-bet figure that changes after placement.

### Server-Side Odds Validation

We calculate odds on the client for display. But when a bet is actually placed, the server recalculates odds from the current pool state. This prevents exploits where someone manipulates the client to claim better odds than they should get.

The server's odds are what get stored in `odds_at_placement` on the bet record.

---

## Chapter 4: Authentication & Roles

### The Signup Flow

Supabase Auth handles the email/password flow. On signup, we insert a row into `profiles` with the user's display name. But there's a subtlety: Supabase doesn't guarantee the `auth.users` row exists when the API responds — the profile insert can race with the auth trigger.

We solved this by using an `upsert` on profile creation rather than a plain `insert`, and by creating missing profiles lazily in the admin users API.

### Admin Access

We added a `role` column to `profiles` with values `'user'` and `'admin'`. The middleware checks this before routing to any `/admin` page.

The first admin is promoted manually with a SQL `UPDATE`. Subsequent admins can be promoted through the admin panel.

One early bug: the middleware was reading the role from the JWT claims, which are cached and don't update immediately when you change the role in the database. We fixed this by reading the role from the `profiles` table on every protected request, not from the token.

---

## Chapter 5: The Admin Dashboard

### What Admins Need

The admin workflow for each match:
1. Create the match (teams, date, venue, CricHeroes link)
2. Add markets to the match (winner, top scorer, over/under, live custom)
3. Add players if using top scorer market
4. Monitor bets during the match
5. Settle markets once results are known
6. Top up wallets at the start of each match

We built dedicated admin pages for all of this — no SQL required.

### The Financial Overview Bug

The admin dashboard showed financial stats: total cash in, total staked, total paid out, and house edge. This originally used a Postgres RPC function `get_financial_overview()`.

The problem: the function's results were being cached by Vercel's edge network. Refreshing the page showed stale numbers for minutes at a time. Admins were confused whether settlements were working.

**Fix:** Replaced the RPC with three direct table queries in the server component using `export const dynamic = 'force-dynamic'`. Direct queries are never cached the same way as function calls, and `force-dynamic` tells Next.js to never cache this page's data.

```ts
// Before: unreliable RPC
const { data } = await admin.rpc('get_financial_overview')

// After: direct queries, always fresh
const [topups, settledBets, winTransactions] = await Promise.all([
  admin.from('transactions').select('amount').eq('type', 'topup'),
  admin.from('bets').select('amount').in('status', ['won', 'lost']),
  admin.from('transactions').select('amount').eq('type', 'win'),
])
```

---

## Chapter 6: Live Scores from CricHeroes

### The Approach

CricHeroes is the platform where BCL matches are scored. We wanted live scores to appear on the match page automatically.

CricHeroes doesn't have a public API. But their web app is Next.js — which means every page embeds full match data in a `<script id="__NEXT_DATA__">` tag.

We built a scraper that:
1. Fetches the CricHeroes match URL
2. Parses the HTML to find the `__NEXT_DATA__` JSON blob
3. Extracts scores, overs, current run rate, wickets, and the winning team
4. Writes this back into the `matches` table

### Auto-Settlement

When the scraper detects a match is complete, it:
1. Finds the Winner market for that match
2. Matches the winning team name to a bet option (fuzzy matching because names don't always match exactly)
3. Calls `settle_market()` to credit all winners automatically

Same for top scorer — finds the highest-scoring batter from the scraped data and settles the Top Scorer market.

### The Cron Job

Vercel supports cron jobs. We set up `0 0 * * *` (daily at midnight) to run the sync. This was a compromise — real real-time would require a WebSocket to CricHeroes, which wasn't feasible.

Admins can also manually trigger settlement from the dashboard after checking CricHeroes themselves.

---

## Chapter 7: The Leaderboard

### Version 1 — Simple Overall Rankings

The first leaderboard was a simple SQL view:
```sql
CREATE VIEW leaderboard AS
SELECT profiles.id, profiles.display_name, profiles.wallet_balance,
  SUM(CASE WHEN transactions.type = 'win' THEN transactions.amount ELSE 0 END) AS total_winnings,
  COUNT(CASE WHEN bets.status = 'won' THEN 1 END) AS bets_won,
  COUNT(bets.id) AS total_bets
FROM profiles
LEFT JOIN bets ON bets.user_id = profiles.id
LEFT JOIN transactions ON transactions.user_id = profiles.id
GROUP BY profiles.id
ORDER BY total_winnings DESC;
```

This worked well. But players wanted more.

### Version 2 — Per-Match Leaderboard

The request: "I want to see who won the most in today's match."

We built a per-match leaderboard endpoint that:
1. Filters bets by `market.match_id = :matchId`
2. Aggregates staked, winnings, and net P&L per player
3. Sorts by net P&L descending

The TypeScript types caused trouble here. Supabase's generated types inferred that `.select('profiles(display_name)')` would return an array of profiles (since the foreign key is `user_id → profiles.id`). But at runtime it returns a single object. We had to use `as unknown as { display_name: string } | null` to appease the type checker.

### The Missing Matches Bug

The per-match dropdown was populated from the server-rendered initial props. When a new match was created after the page was built, it wouldn't appear in the dropdown until the page was redeployed or the server cache expired.

**Fix:** When the "By Match" tab is clicked, the client fetches `/api/matches` fresh. This guarantees the dropdown always reflects the current state of the database, regardless of when the page was last built or cached.

```ts
useEffect(() => {
  if (tab !== 'match') return
  fetch('/api/matches')
    .then(r => r.json())
    .then(data => setLiveMatches(data))
}, [tab])
```

---

## Chapter 8: The Betting UX

### Markets Expanded by Default — Then Not

Initially all markets loaded expanded so players could see odds immediately. This worked fine with 2-3 markets. Once we had 5-6 markets per match, the page was overwhelming.

We collapsed markets by default. Players expand what they care about. The expanded state is tracked in a `Set<string>` in React state — no server round-trip needed.

The first collapse implementation had a bug: `isExpanded = expandedMarkets.has(market.id) || isOpen`. This meant "open" markets (status = 'open') were always expanded even after the user collapsed them. Fixed by removing the `|| isOpen` fallback.

### The Last-Minute Betting Problem

As the tournament progressed, a pattern emerged: most bets flooded in 5 minutes before market close. This caused two problems:
1. Odds shifted dramatically right before close, catching early bettors off guard
2. It removed the strategic element — you could just wait to see which side was favored

We brainstormed 13+ solutions. The chosen approach: two features that work together.

**Feature 1: Show who's betting (transparency)**
When a market is expanded, you can see the first names of everyone who's already bet on each option, with small name chips. This makes the market feel more social and gives early bettors credit for their position.

**Feature 2: Early bird bonus (incentive)**
Bets placed within 30 minutes of market creation earn +10% on their payout. The incentive is visible — a yellow ⚡ banner appears in the BetSlip when the window is still open. The bonus is applied in the `settle_market()` SQL function, so it cannot be gamed from the client.

### Lazy Bettors Loading

We didn't want to load all bettors for all markets on page load — that could be 100+ database rows for a busy match. Bettors are fetched per market only when that market is expanded.

```ts
function toggleExpand(marketId: string) {
  setExpandedMarkets(prev => {
    const next = new Set(prev)
    if (next.has(marketId)) {
      next.delete(marketId)
    } else {
      next.add(marketId)
      if (!bettors[marketId]) fetchBettors(marketId) // lazy fetch
    }
    return next
  })
}
```

After a new bet is placed, bettors are re-fetched for that market so the new bettor appears immediately.

---

## Chapter 9: RLS vs. Admin Queries

### The Problem

The leaderboard needs to join across user IDs. Bettors API needs to read all bets on a market. These queries fail under RLS because a regular user can only see their own rows.

### The Solution

Supabase's service role key bypasses RLS. We use it in server-side API routes for any cross-user query. The key is:
- **Never exposed to the client** — only used in `route.ts` files and server components
- **Only used where necessary** — regular user-facing queries still use the anon client with RLS

We created a `createAdminClient()` function in `lib/supabase-server.ts`:

```ts
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

Routes that use this: leaderboard, bettors API, admin pages, cron job.

---

## Chapter 10: Deployment Challenges

### Vercel Caching

Next.js on Vercel aggressively caches page data. For a betting app, stale data is dangerous — players could see wrong odds or wrong balances.

We added `export const dynamic = 'force-dynamic'` to every page that shows live data. This tells Vercel to never cache the page's server-rendered output.

### TypeScript Build Failures

Vercel runs `tsc` during build. Several times, code worked in dev but failed to deploy because of TypeScript errors that weren't caught locally (we had some strict checks disabled in VS Code).

The most common pattern was Supabase join types. When you join a related table in a Supabase query, TypeScript types it as an array (the relation could theoretically return multiple rows). But foreign key joins to a unique field return a single object at runtime.

The safe workaround:
```ts
const name = (bet.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Unknown'
```

Using `as unknown as` is a double cast that bypasses the type mismatch. It's not ideal but it's explicit — the comment communicates intent better than a complex generic.

### Environment Variable Confusion

For a while, the admin client was accidentally using the anon key instead of the service role key. Queries that should bypass RLS were still being blocked. The bug was a copy-paste error in `.env.local`.

The symptoms: `null` results from queries that should return data. The fix: triple-check which key is being used and add explicit comments in the code noting which client is which.

---

## What We Learned

### Things That Worked Well

- **Pari-mutuel odds** — no manual price setting, self-correcting, always fair
- **Supabase RPC for financial operations** — atomic transactions at the DB level are bulletproof
- **`force-dynamic` everywhere** — eliminates a whole class of stale data bugs
- **Admin client separation** — clear separation of "user can see this" vs "server-side only"
- **Lazy loading** — bettors are only fetched when actually needed; keeps the initial page fast

### Things We'd Do Differently

- **Set up stricter TypeScript from day one** — the Supabase type issues would have been caught earlier
- **Use Supabase Realtime from the start** — we added it for scores late; it could have powered live odds updates too
- **Migration discipline** — we made some schema changes directly in the Supabase dashboard, then had to reconstruct them in the migration files. All changes should go through migration files from the start.
- **Test the cron job locally** — we couldn't easily test the cron-triggered auto-settlement, which led to a few manual interventions during matches

### Moments of Pride

- The odds update live in the BetSlip as you type your stake amount — the UX feels professional
- The early bird bonus is applied entirely in SQL, making it impossible to game from the client
- The entire platform ran a full tournament with 15+ players, 8+ matches, and hundreds of bets without a single data integrity issue
- A non-technical admin managed the whole tournament — creating matches, settling markets, topping up wallets — without touching the database once

---

## Feature Timeline

| Feature | Why It Was Added |
|---|---|
| Basic match + market creation | Core requirement |
| Pari-mutuel odds engine | Fair, self-managing odds |
| Wallet & atomic bet placement | Prevent double-spending |
| Admin dashboard | Non-technical tournament management |
| CricHeroes score scraping | Live scores without a real API |
| Auto-settlement via cron | Remove manual work post-match |
| Leaderboard view | Tournament competition tracking |
| Per-match leaderboard | "Who won today?" was a common question |
| Force-dynamic on all pages | Fix stale admin data |
| Markets collapsed by default | Too many expanded markets was overwhelming |
| Client-side match refresh on leaderboard | New matches weren't appearing in dropdown |
| Show bettor names under each option | Make markets feel social |
| Early bird bonus | Discourage last-minute pile-ons, reward strategic bettors |

---

## The Numbers (At Time of Writing)

- Matches managed: 8+
- Markets created: 30+
- Bets placed: 200+
- Players active: 15
- Zero data integrity incidents
- Zero cases of a wallet going negative

---

*Built with Next.js, Supabase, Tailwind CSS, and a lot of debugging.*

# BCL Bet — Multi-Sport Expansion Design
**Date:** 2026-07-12

## Overview

Expand BCL Bet from a cricket-only tournament betting platform to a 6-sport hub covering cricket, football, table tennis, volleyball, pool, and basketball. Each sport gets its own landing page (`/sports/[sport]`). The homepage becomes a sports hub. Admin can manage teams and matches per sport. No live scores for any sport — admin manually settles markets after results.

---

## Sports & Markets

| Sport | market_type values available |
|---|---|
| Cricket | winner, top_scorer, over_under |
| Football | winner, first_goal_scorer, over_under |
| Table Tennis | winner, set_winner, handicap |
| Volleyball | winner, set_winner |
| Pool | winner, frame_handicap |
| Basketball | winner, over_under, handicap |

---

## Section 1 — Database Migration (`002_multisport.sql`)

### New enum: `sport_type`
```sql
CREATE TYPE sport_type AS ENUM (
  'cricket', 'football', 'table_tennis', 'volleyball', 'pool', 'basketball'
);
```

### New table: `teams`
```sql
CREATE TABLE teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  sport sport_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view teams" ON teams FOR SELECT USING (true);
```

### Updated table: `matches`
- Add `sport sport_type NOT NULL DEFAULT 'cricket'`
- Keep `team_a TEXT` and `team_b TEXT` — admin picks from the teams dropdown, which writes the team name as text. No FK needed; the `teams` table is admin-UI-only.
- Drop columns: `cricheroes_match_id`, `cricheroes_slug`, `live_score_a`, `live_score_b`, `live_overs_a`, `live_overs_b`, `live_crr`, `live_rrr`, `over_under_line`
- Note: `over_under` market type still exists. The line value (e.g. "Over 5.5 goals") is stored as a `bet_options.label`, not a column.

### Updated enum: `market_type`
```sql
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'first_goal_scorer';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'set_winner';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'handicap';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'frame_handicap';
```

### New RPC: `reset_season()`
Replaces current "Full Reset". Deletes all matches (cascades to markets, bets, transactions), deletes all teams, zeros all wallet balances. Requires admin. Called from a new "Season Reset" button in the admin panel.

```sql
CREATE OR REPLACE FUNCTION reset_season() RETURNS VOID AS $$
BEGIN
  DELETE FROM matches;       -- cascades to markets, bet_options, bets, players
  DELETE FROM teams;
  UPDATE profiles SET wallet_balance = 0;
  DELETE FROM transactions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Data on deploy
- Run `reset_season()` once manually after migration to clear existing cricket data.
- Teams are added fresh by admin before matches are created.

---

## Section 2 — Routes

| Route | Description |
|---|---|
| `/` | Sports hub — 6 sport cards with emoji, upcoming match count, link to sport page |
| `/sports/[sport]` | Match list for one sport (live → upcoming → completed sections) |
| `/sports/[sport]/[matchId]` | Match detail + betting (same functionality as current `/matches/[id]`) |
| `/leaderboard` | Unchanged |
| `/dashboard` | Unchanged |
| `/admin` | Updated — Season Reset replaces Full Reset |
| `/admin/teams` | Add / delete teams per sport |
| `/admin/matches` | Updated — sport selector → team dropdowns |
| `/admin/matches/[id]` | Edit match / manage markets (unchanged functionality) |

Old route `/matches/[id]` is removed (clean slate — no existing match URLs to redirect).

---

## Section 3 — Admin UI Changes

### `/admin/teams` (new page)
- Sport tab selector at top (Cricket / Football / TT / Volleyball / Pool / Basketball)
- List of teams for selected sport with delete button per team
- Add team form: name input + sport (pre-selected from active tab) → POST to `/api/admin/teams`
- No edit — delete and re-add if name needs changing

### `/admin/matches` (updated)
- Create match form gains:
  1. **Sport selector** (first field, required)
  2. **Team A dropdown** — options filtered from `teams` table by selected sport
  3. **Team B dropdown** — same, excludes Team A selection
- Market type selector shows only the market types valid for the selected sport (enforced in UI)
- Date/venue fields unchanged

### Admin panel (`/admin`)
- "Season Reset" button replaces "Full Reset" in FinancialOverview
- Confirmation: user must type "RESET SEASON" (not just "RESET")
- Wipes matches, teams, transactions, zeros wallets

### New API routes
- `GET /api/admin/teams?sport=[sport]` — list teams by sport
- `POST /api/admin/teams` — create team `{ name, sport }`
- `DELETE /api/admin/teams/[id]` — delete team

---

## Section 4 — Frontend Components

### Homepage (`/`) — Sports Hub
Replace current match list with a grid of 6 sport cards:
- Sport emoji icon + name
- Count of upcoming matches (fetched server-side)
- "View matches →" link to `/sports/[sport]`
- BITSoM navy/orange theme consistent with existing cards

### `/sports/[sport]/page.tsx` (new)
- Server component, mirrors current homepage structure (live → upcoming → completed sections)
- Filters matches by sport from Supabase
- Reuses existing `MatchCard` component (add sport badge to card)
- Links to `/sports/[sport]/[matchId]`

### `/sports/[sport]/[matchId]/page.tsx` (new)
- Move current `app/matches/[id]/page.tsx` here
- Remove all live score display (LiveScoreCard component removed from this page)
- Remove CricHeroes external link
- Betting UI (BetSlip, MarketsSection) unchanged

### MatchCard (updated)
- Add a small sport emoji badge (e.g. 🏏 🏀 ⚽) to top-left of card
- Link updated to `/sports/[sport]/[matchId]`

### Navbar (updated)
- "Matches" link replaced with "Sports" dropdown (or 6 direct icon links)
- Links: /sports/cricket, /sports/football, /sports/table_tennis, /sports/volleyball, /sports/pool, /sports/basketball

### Removed components / files
- `components/betting/LiveScoreCard.tsx` — deleted
- `app/api/cron/sync-scores/route.ts` — deleted
- `app/api/cricheroes/route.ts` — deleted
- `vercel.json` cron entry — removed
- `app/matches/[id]/page.tsx` — deleted (replaced by new route)

---

## Section 5 — Sport Label Map (used throughout UI)

```ts
export const SPORTS = {
  cricket:       { label: 'Cricket',       emoji: '🏏' },
  football:      { label: 'Football',      emoji: '⚽' },
  table_tennis:  { label: 'Table Tennis',  emoji: '🏓' },
  volleyball:    { label: 'Volleyball',    emoji: '🏐' },
  pool:          { label: 'Pool',          emoji: '🎱' },
  basketball:    { label: 'Basketball',    emoji: '🏀' },
} as const

export const SPORT_MARKETS: Record<string, string[]> = {
  cricket:      ['winner', 'top_scorer', 'over_under'],
  football:     ['winner', 'first_goal_scorer', 'over_under'],
  table_tennis: ['winner', 'set_winner', 'handicap'],
  volleyball:   ['winner', 'set_winner'],
  pool:         ['winner', 'frame_handicap'],
  basketball:   ['winner', 'over_under', 'handicap'],
}
```

---

## Out of Scope

- Live score syncing for any sport
- Player statistics or performance tracking
- External score APIs (CricHeroes removed, no replacement)
- Sport-specific UI layouts (all sports share the same MatchCard/BetSlip)
- Team logos or profile pages

# Fantasy League Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dream11-style fantasy league for cricket and football, sharing one wallet and one pool-settlement model with the existing pari-mutuel betting product.

**Architecture:** Three pure, dependency-free modules (`scoring`, `lineup`, `prizes`) hold every rule and are unit tested in isolation. API routes compose them and hand results to guarded Postgres RPCs that apply money atomically. No points, credits, or payouts are ever computed on the client. The nav gains a mode chooser at `/sports/[sport]` for the two fantasy sports; the existing match list moves to `/sports/[sport]/betting` untouched.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + PostgREST + RLS), Tailwind, Zod, Vitest.

## Global Constraints

- Fantasy applies to **cricket and football only**. The other four sports keep betting-only navigation.
- Squad: **11 players**, **100 credit** budget, **max 7 from one team**. Captain **2×**, vice-captain **1.5×**.
- Player price is `credits = 6 + rating × 0.5` — already a generated column on `team_players`. Never recompute it.
- Football position quotas: exactly **1 GK**, **3–5 DEF**, **3–5 MID**, **1–3 FWD**, read from `team_players.role`. Cricket has **no** quotas (its roles are auction tiers — Captain/Marquee/Intermediate/Novice — not playing positions).
- Entry fee default **₹100**, house edge **5%**, `prize_pool = entry_fee × entrants × 0.95`.
- Prize splits: **10+ entrants** → top 5 at 40/25/15/12/8%; **4–9** → top 3 at 50/30/20%; **under 4** → void and refund.
- Ties split the combined prize for the places they occupy.
- Money columns are Postgres `NUMERIC`; PostgREST returns them as **strings**. Always coerce with `Number()`.
- Currency INR, displayed with `toLocaleString('en-IN')`.
- **Every new `SECURITY DEFINER` function must be followed by `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`.** Migration 007 shipped without this and exposed an unbounded money printer to anyone holding the public anon key. This is not optional.
- **Every payout total must be provably ≤ the pool it draws from.** Round awards **down** to the paisa (`Math.floor(x*100)/100`); the remainder stays with the house. Rounding to nearest breaks the invariant.
- Reuse existing Tailwind tokens only: `bg-table`, `bg-raised`, `bg-baize`, `border-rail`, `text-slate`, `text-gold`, `text-amber`, `text-white`, `bg-royal`, `bg-crimson`. Introduce no new colours.

## Deliberate decisions that override or extend the spec

**1. Settlement is split in two. The spec is wrong on this point.**
`docs/superpowers/specs/2026-07-25-fantasy-league-design.md:311` says "Publishing is idempotent — re-publishing recomputes points and payouts." Recomputing payouts after money has moved is precisely the double-credit bug found in `apply_settlement` during the betting rework. Instead:
- **Save stats** — fully idempotent. Recomputes points and ranks. Moves no money. The admin may revise as often as they like.
- **Settle contest** — one-time, guarded by `SELECT ... FOR UPDATE` plus a status check. Pays out, then marks the contest settled. Refuses if already settled.

**2. Lineups are private until lock.** Seeing a rival's XI before the deadline is a competitive leak. RLS lets a user read only their own entry; the leaderboard is served by a route that returns `display_name`, `total_points`, `rank` and `payout` — never the lineup — and only once the contest is no longer `open`.

**3. Enum values ship in their own migration.** `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds it. The migration runner posts each file as a single query, so `transaction_type` gains its new values in migration 009, alone, before 010 references them.

**4. Contests are created explicitly by an admin**, one per match (`UNIQUE (match_id)`), mirroring how markets are created today. `locks_at` defaults to the match's `match_date`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/009_fantasy_enums.sql` | `transaction_type` += `fantasy_entry`, `fantasy_prize`; `contest_status` type |
| `supabase/migrations/010_fantasy_schema.sql` | 4 tables, RLS, indexes |
| `supabase/migrations/011_fantasy_rpcs.sql` | `enter_contest`, `save_player_stats`, `settle_contest` + grants |
| `lib/fantasy/scoring.ts` + `.test.ts` | Stats → points. Pure, table-driven |
| `lib/fantasy/lineup.ts` + `.test.ts` | Budget, count, per-team cap, quotas, C/VC |
| `lib/fantasy/prizes.ts` + `.test.ts` | Ranking, tie handling, prize distribution |
| `app/api/admin/contests/route.ts` | Create / update / delete a contest |
| `app/api/fantasy/entry/route.ts` | Join a contest, submit or edit a lineup |
| `app/api/fantasy/squad/route.ts` | Selectable players for a match, with credits |
| `app/api/fantasy/leaderboard/route.ts` | Contest standings, lineup-free |
| `app/api/admin/fantasy/stats/route.ts` | Save stats, recompute points |
| `app/api/admin/fantasy/settle/route.ts` | Settle a contest once |
| `app/sports/[sport]/page.tsx` | Mode chooser (cricket/football) or redirect |
| `app/sports/[sport]/betting/page.tsx` | The existing match list, moved verbatim |
| `app/sports/[sport]/fantasy/page.tsx` | Contest list for the sport |
| `app/sports/[sport]/fantasy/[matchId]/page.tsx` | Contest detail shell |
| `components/fantasy/TeamBuilder.tsx` | Squad picker, credit meter, C/VC |
| `components/fantasy/ContestLeaderboard.tsx` | Standings table |
| `components/admin/StatEntry.tsx` | Five-stat entry grid |
| `scripts/verify-fantasy.mjs` | Post-deploy gate |

---

## Task 1: Enum values

**Files:**
- Create: `supabase/migrations/009_fantasy_enums.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `transaction_type` values `fantasy_entry`, `fantasy_prize`; type `contest_status` with values `open`, `locked`, `settled`, `void`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 009_fantasy_enums.sql
--
-- Enum changes ONLY, deliberately alone in this file.
-- ALTER TYPE ... ADD VALUE cannot be used inside the same transaction
-- that adds it, and the migration runner posts each file as one query.
-- Migration 010 is the first file allowed to reference these values.
-- ============================================================

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'fantasy_entry';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'fantasy_prize';

DO $$ BEGIN
  CREATE TYPE contest_status AS ENUM ('open', 'locked', 'settled', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Apply it**

Run: `SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-migration.mjs supabase/migrations/009_fantasy_enums.sql`
Expected: `OK: []`

- [ ] **Step 3: Verify both enums**

Write a throwaway script using the `.env.local` parsing pattern from `scripts/verify.mjs`, and confirm via a service-role query that `transaction_type` now contains both new labels and `contest_status` exists. Delete the throwaway afterwards.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/009_fantasy_enums.sql
git commit -m "feat: fantasy enum values"
```

---

## Task 2: Fantasy schema

**Files:**
- Create: `supabase/migrations/010_fantasy_schema.sql`

**Interfaces:**
- Consumes: `contest_status` from Task 1
- Produces: tables `contests`, `contest_entries`, `entry_players`, `player_match_stats`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 010_fantasy_schema.sql
--
-- Dream11-style fantasy for cricket and football. Contests pool entry
-- fees exactly like a betting market: fees in, 5% house edge, the rest
-- distributed — by rank rather than by outcome.
-- ============================================================

CREATE TABLE IF NOT EXISTS contests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_fee      NUMERIC(10,2) NOT NULL DEFAULT 100 CHECK (entry_fee >= 0),
  house_edge_pct NUMERIC(4,2)  NOT NULL DEFAULT 5.0 CHECK (house_edge_pct >= 0 AND house_edge_pct <= 20),
  status         contest_status NOT NULL DEFAULT 'open',
  prize_pool     NUMERIC(12,2) NOT NULL DEFAULT 0,
  locks_at       TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id)
);

CREATE TABLE IF NOT EXISTS contest_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contest_id      UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  captain_id      UUID REFERENCES team_players(id),
  vice_captain_id UUID REFERENCES team_players(id),
  total_points    NUMERIC(8,2),
  rank            INT,
  payout          NUMERIC(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS entry_players (
  entry_id  UUID NOT NULL REFERENCES contest_entries(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES team_players(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_match_stats (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES team_players(id) ON DELETE CASCADE,
  played      BOOLEAN NOT NULL DEFAULT false,
  -- cricket
  runs        INT NOT NULL DEFAULT 0 CHECK (runs     >= 0),
  wickets     INT NOT NULL DEFAULT 0 CHECK (wickets  >= 0),
  catches     INT NOT NULL DEFAULT 0 CHECK (catches  >= 0),
  sixes       INT NOT NULL DEFAULT 0 CHECK (sixes    >= 0),
  run_outs    INT NOT NULL DEFAULT 0 CHECK (run_outs >= 0),
  -- football
  goals       INT NOT NULL DEFAULT 0 CHECK (goals   >= 0),
  assists     INT NOT NULL DEFAULT 0 CHECK (assists >= 0),
  saves       INT NOT NULL DEFAULT 0 CHECK (saves   >= 0),
  clean_sheet BOOLEAN NOT NULL DEFAULT false,
  yellows     INT NOT NULL DEFAULT 0 CHECK (yellows >= 0),
  reds        INT NOT NULL DEFAULT 0 CHECK (reds    >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_contests_match       ON contests(match_id);
CREATE INDEX IF NOT EXISTS idx_entries_contest      ON contest_entries(contest_id);
CREATE INDEX IF NOT EXISTS idx_entries_user         ON contest_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entry_players_entry  ON entry_players(entry_id);
CREATE INDEX IF NOT EXISTS idx_stats_match          ON player_match_stats(match_id);

-- ------------------------------------------------------------
-- RLS. Lineups stay private until the contest locks: a rival's XI
-- before the deadline is a competitive leak. Standings are served by
-- app/api/fantasy/leaderboard, which returns no lineup at all.
-- ------------------------------------------------------------
ALTER TABLE contests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_match_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Anyone can view contests" ON contests FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users see own entries" ON contest_entries
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users see own entry players" ON entry_players
    FOR SELECT USING (EXISTS (
      SELECT 1 FROM contest_entries e
      WHERE e.id = entry_players.entry_id AND e.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can view player stats" ON player_match_stats
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No INSERT/UPDATE/DELETE policies anywhere: every write goes through a
-- SECURITY DEFINER RPC called with the service-role key from a server route.
```

- [ ] **Step 2: Apply and verify**

Apply as in Task 1. Then verify with a throwaway script that all four tables are selectable with the service-role key, and that `contest_entries` is **not** readable with the anon key (expect an empty array or a permission error, never another user's row). Delete the throwaway.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_fantasy_schema.sql
git commit -m "feat: fantasy schema — contests, entries, lineups, player stats"
```

---

## Task 3: Scoring module

**Files:**
- Create: `lib/fantasy/scoring.ts`, `lib/fantasy/scoring.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `FantasySport`, `PlayerStats`, `CRICKET_POINTS`, `FOOTBALL_POINTS`, `CAPTAIN_MULTIPLIER`, `VICE_CAPTAIN_MULTIPLIER`, `playerPoints(stats, sport)`, `entryPoints(playerIds, captainId, viceCaptainId, statsByPlayer, sport)`

- [ ] **Step 1: Write the failing test**

Create `lib/fantasy/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  playerPoints, entryPoints, CAPTAIN_MULTIPLIER, VICE_CAPTAIN_MULTIPLIER,
  type PlayerStats,
} from './scoring'

const blank = (over: Partial<PlayerStats> = {}): PlayerStats => ({
  player_id: 'p', played: true, runs: 0, wickets: 0, catches: 0, sixes: 0, run_outs: 0,
  goals: 0, assists: 0, saves: 0, clean_sheet: false, yellows: 0, reds: 0, ...over,
})

describe('playerPoints — cricket', () => {
  it('gives 2 for turning up', () => {
    expect(playerPoints(blank(), 'cricket')).toBe(2)
  })

  it('scores nothing at all for a player who did not play', () => {
    expect(playerPoints(blank({ played: false, runs: 50 }), 'cricket')).toBe(0)
  })

  it('adds 1 per run', () => {
    expect(playerPoints(blank({ runs: 50 }), 'cricket')).toBe(52)
  })

  it('adds 25 per wicket, so 3 wickets beats a fifty', () => {
    const bowler = playerPoints(blank({ wickets: 3 }), 'cricket')
    const batter = playerPoints(blank({ runs: 50 }), 'cricket')
    expect(bowler).toBe(77)
    expect(bowler).toBeGreaterThan(batter)
  })

  it('adds 8 per catch and 12 per run-out', () => {
    expect(playerPoints(blank({ catches: 2, run_outs: 1 }), 'cricket')).toBe(30)
  })

  it('adds a 2-point bonus per six on top of the runs', () => {
    // 30 runs including two sixes: 30 + 2*2 + 2 played
    expect(playerPoints(blank({ runs: 30, sixes: 2 }), 'cricket')).toBe(36)
  })

  it('ignores football stats when scoring cricket', () => {
    expect(playerPoints(blank({ goals: 5 }), 'cricket')).toBe(2)
  })
})

describe('playerPoints — football', () => {
  it('adds 10 per goal and 6 per assist', () => {
    expect(playerPoints(blank({ goals: 2, assists: 1 }), 'football')).toBe(28)
  })

  it('adds 3 per save and 6 for a clean sheet', () => {
    expect(playerPoints(blank({ saves: 4, clean_sheet: true }), 'football')).toBe(20)
  })

  it('subtracts 2 per yellow and 6 per red', () => {
    expect(playerPoints(blank({ yellows: 1, reds: 1 }), 'football')).toBe(-6)
  })

  it('can go negative overall', () => {
    expect(playerPoints(blank({ reds: 2 }), 'football')).toBe(-10)
  })

  it('ignores cricket stats when scoring football', () => {
    expect(playerPoints(blank({ wickets: 3 }), 'football')).toBe(2)
  })
})

describe('entryPoints', () => {
  const stats = new Map<string, PlayerStats>([
    ['a', blank({ player_id: 'a', runs: 50 })],   // 52
    ['b', blank({ player_id: 'b', wickets: 2 })], // 52
    ['c', blank({ player_id: 'c', catches: 1 })], // 10
  ])

  it('doubles the captain and multiplies the vice by 1.5', () => {
    // 52*2 + 52*1.5 + 10 = 104 + 78 + 10
    expect(entryPoints(['a', 'b', 'c'], 'a', 'b', stats, 'cricket')).toBe(192)
  })

  it('treats a player with no stats row as zero', () => {
    expect(entryPoints(['a', 'zzz'], 'a', 'zzz', stats, 'cricket')).toBe(104)
  })

  it('does not stack both multipliers on one player', () => {
    expect(entryPoints(['a'], 'a', 'a', stats, 'cricket')).toBe(52 * CAPTAIN_MULTIPLIER)
  })

  it('applies the vice multiplier to a negative score too', () => {
    const s = new Map([['x', blank({ player_id: 'x', reds: 1 })]]) // -4
    expect(entryPoints(['x'], 'none', 'x', s, 'football')).toBe(-4 * VICE_CAPTAIN_MULTIPLIER)
  })

  it('rounds to two decimals so 1.5x never leaves float dust', () => {
    const s = new Map([['y', blank({ player_id: 'y', runs: 33 })]]) // 35
    expect(entryPoints(['y'], 'none', 'y', s, 'cricket')).toBe(52.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/fantasy/scoring.test.ts`
Expected: FAIL — cannot resolve `./scoring`

- [ ] **Step 3: Write the implementation**

Create `lib/fantasy/scoring.ts`:

```ts
/**
 * Fantasy scoring. Pure and dependency-free so it runs identically in the
 * browser (to preview a lineup) and on the server (to settle a contest).
 *
 * Five capturable stats per sport, chosen so one scorer with a phone can
 * record a whole match live. Deliberately excluded: strike rate, economy and
 * minutes played — each needs a second input field to compute, roughly
 * doubling data entry for modest gain.
 */

export type FantasySport = 'cricket' | 'football'

export interface PlayerStats {
  player_id: string
  played: boolean
  // cricket
  runs?: number
  wickets?: number
  catches?: number
  sixes?: number
  run_outs?: number
  // football
  goals?: number
  assists?: number
  saves?: number
  clean_sheet?: boolean
  yellows?: number
  reds?: number
}

/** Points for simply being in the XI, both sports. A benched pick scores nothing. */
export const APPEARANCE_POINTS = 2

export const CRICKET_POINTS = {
  runs: 1,
  wickets: 25,
  catches: 8,
  sixes: 2,      // bonus, on top of the run itself
  run_outs: 12,
} as const

export const FOOTBALL_POINTS = {
  goals: 10,
  assists: 6,
  saves: 3,
  clean_sheet: 6,
  yellows: -2,
  reds: -6,
} as const

export const CAPTAIN_MULTIPLIER = 2
export const VICE_CAPTAIN_MULTIPLIER = 1.5

const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Points a single player earned. Zero if they did not play. */
export function playerPoints(stats: PlayerStats, sport: FantasySport): number {
  if (!stats.played) return 0

  if (sport === 'cricket') {
    return (
      APPEARANCE_POINTS +
      n(stats.runs)     * CRICKET_POINTS.runs +
      n(stats.wickets)  * CRICKET_POINTS.wickets +
      n(stats.catches)  * CRICKET_POINTS.catches +
      n(stats.sixes)    * CRICKET_POINTS.sixes +
      n(stats.run_outs) * CRICKET_POINTS.run_outs
    )
  }

  return (
    APPEARANCE_POINTS +
    n(stats.goals)   * FOOTBALL_POINTS.goals +
    n(stats.assists) * FOOTBALL_POINTS.assists +
    n(stats.saves)   * FOOTBALL_POINTS.saves +
    (stats.clean_sheet ? FOOTBALL_POINTS.clean_sheet : 0) +
    n(stats.yellows) * FOOTBALL_POINTS.yellows +
    n(stats.reds)    * FOOTBALL_POINTS.reds
  )
}

/**
 * Total for a whole XI. The captain's score is doubled and the vice-captain's
 * multiplied by 1.5; if the same player somehow holds both, only the captain
 * multiplier applies rather than the two compounding.
 */
export function entryPoints(
  playerIds: string[],
  captainId: string,
  viceCaptainId: string,
  statsByPlayer: Map<string, PlayerStats>,
  sport: FantasySport,
): number {
  let total = 0
  for (const id of playerIds) {
    const stats = statsByPlayer.get(id)
    if (!stats) continue
    const base = playerPoints(stats, sport)
    const multiplier =
      id === captainId ? CAPTAIN_MULTIPLIER
      : id === viceCaptainId ? VICE_CAPTAIN_MULTIPLIER
      : 1
    total += base * multiplier
  }
  return round2(total)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/fantasy/scoring.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Commit**

```bash
git add lib/fantasy/scoring.ts lib/fantasy/scoring.test.ts
git commit -m "feat: fantasy scoring — five capturable stats per sport"
```

---

## Task 4: Lineup validation

**Files:**
- Create: `lib/fantasy/lineup.ts`, `lib/fantasy/lineup.test.ts`

**Interfaces:**
- Consumes: `FantasySport` from Task 3
- Produces: `SQUAD_SIZE`, `CREDIT_BUDGET`, `MAX_PER_TEAM`, `FOOTBALL_QUOTAS`, `SelectablePlayer`, `LineupSelection`, `LineupError`, `lineupCost(playerIds, pool)`, `validateLineup(selection, pool, sport)`

- [ ] **Step 1: Write the failing test**

Create `lib/fantasy/lineup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateLineup, lineupCost, type SelectablePlayer } from './lineup'

/** 14 cricketers per team, priced so budget pressure is realistic. */
function cricketPool(): SelectablePlayer[] {
  const out: SelectablePlayer[] = []
  for (const team of ['T1', 'T2']) {
    for (let i = 0; i < 14; i++) {
      out.push({
        id: `${team}-${i}`,
        name: `${team} Player ${i}`,
        role: 'Novice',
        credits: i < 4 ? 11 : i < 8 ? 8.5 : 6.5,
        team_id: team,
      })
    }
  }
  return out
}

function footballPool(): SelectablePlayer[] {
  const out: SelectablePlayer[] = []
  for (const team of ['T1', 'T2']) {
    const shape: [string, number][] = [['GK', 2], ['DEF', 5], ['MID', 5], ['FWD', 2]]
    let i = 0
    for (const [role, count] of shape) {
      for (let k = 0; k < count; k++) {
        out.push({ id: `${team}-${role}-${k}`, name: `${role}${k}`, role, credits: 7, team_id: team })
        i++
      }
    }
  }
  return out
}

const codes = (errs: { code: string }[]) => errs.map(e => e.code).sort()

describe('lineupCost', () => {
  it('sums credits and copes with NUMERIC strings from PostgREST', () => {
    const pool: SelectablePlayer[] = [
      { id: 'a', name: 'A', role: 'x', credits: '7.5', team_id: 'T1' },
      { id: 'b', name: 'B', role: 'x', credits: 9, team_id: 'T1' },
    ]
    expect(lineupCost(['a', 'b'], pool)).toBe(16.5)
  })

  it('ignores ids that are not in the pool', () => {
    expect(lineupCost(['ghost'], [])).toBe(0)
  })
})

describe('validateLineup — cricket', () => {
  const pool = cricketPool()
  // 4 cheap from T1, 4 cheap from T2, 3 mid — 7 max per team respected
  const legal = ['T1-8','T1-9','T1-10','T1-11','T2-8','T2-9','T2-10','T2-11','T1-4','T2-4','T2-5']

  it('accepts a legal XI', () => {
    expect(validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')).toEqual([])
  })

  it('rejects the wrong number of players', () => {
    const errs = validateLineup({ playerIds: legal.slice(0, 10), captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('SQUAD_SIZE')
  })

  it('rejects going over budget', () => {
    const rich = ['T1-0','T1-1','T1-2','T1-3','T2-0','T2-1','T2-2','T2-3','T1-4','T2-4','T2-5']
    const errs = validateLineup({ playerIds: rich, captainId: 'T1-0', viceCaptainId: 'T2-0' }, pool, 'cricket')
    expect(codes(errs)).toContain('OVER_BUDGET')
  })

  it('rejects more than 7 from one team', () => {
    const stacked = ['T1-8','T1-9','T1-10','T1-11','T1-12','T1-13','T1-4','T1-5','T2-8','T2-9','T2-10']
    const errs = validateLineup({ playerIds: stacked, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('MAX_PER_TEAM')
  })

  it('rejects duplicate picks', () => {
    const dupes = ['T1-8','T1-8','T1-10','T1-11','T2-8','T2-9','T2-10','T2-11','T1-4','T2-4','T2-5']
    const errs = validateLineup({ playerIds: dupes, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('DUPLICATE_PLAYER')
  })

  it('rejects a player who is not in either squad', () => {
    const alien = [...legal.slice(0, 10), 'SOMEONE-ELSE']
    const errs = validateLineup({ playerIds: alien, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('UNKNOWN_PLAYER')
  })

  it('requires the captain to be in the XI', () => {
    const errs = validateLineup({ playerIds: legal, captainId: 'T1-0', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('CAPTAIN_NOT_IN_SQUAD')
  })

  it('requires captain and vice to be different people', () => {
    const errs = validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T1-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('CAPTAIN_IS_VICE')
  })

  it('applies no positional quotas to cricket', () => {
    // every pick is a 'Novice'; football would reject this outright
    expect(validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')).toEqual([])
  })
})

describe('validateLineup — football', () => {
  const pool = footballPool()
  const legal = [
    'T1-GK-0',
    'T1-DEF-0','T1-DEF-1','T2-DEF-0',
    'T1-MID-0','T1-MID-1','T2-MID-0',
    'T1-FWD-0','T2-FWD-0',
    'T2-DEF-1','T2-MID-1',
  ]

  it('accepts a legal XI of 1 GK, 4 DEF, 4 MID, 2 FWD', () => {
    expect(validateLineup({ playerIds: legal, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')).toEqual([])
  })

  it('rejects a lineup with no goalkeeper', () => {
    const noGk = [...legal.slice(1), 'T2-DEF-2']
    const errs = validateLineup({ playerIds: noGk, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_GK')
  })

  it('rejects two goalkeepers', () => {
    const twoGk = ['T1-GK-0','T2-GK-0', ...legal.slice(1, 10)]
    const errs = validateLineup({ playerIds: twoGk, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_GK')
  })

  it('rejects too few defenders', () => {
    const thinBack = ['T1-GK-0','T1-DEF-0','T1-MID-0','T1-MID-1','T2-MID-0','T2-MID-1','T1-FWD-0','T2-FWD-0','T1-MID-2','T2-MID-2','T2-MID-3']
    const errs = validateLineup({ playerIds: thinBack, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_DEF')
  })

  it('reports every violation at once rather than stopping at the first', () => {
    const errs = validateLineup({ playerIds: ['T1-GK-0'], captainId: 'nope', viceCaptainId: 'nope' }, pool, 'football')
    expect(errs.length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/fantasy/lineup.test.ts`
Expected: FAIL — cannot resolve `./lineup`

- [ ] **Step 3: Write the implementation**

Create `lib/fantasy/lineup.ts`:

```ts
/**
 * Lineup rules. Pure, so the team builder and the server enforce exactly the
 * same constraints — the client copy is a convenience, the server copy is the
 * authority.
 *
 * Returns ALL violations rather than the first, so the builder can show a
 * complete checklist instead of making the user fix one thing at a time.
 */
import type { FantasySport } from './scoring'

export const SQUAD_SIZE = 11
export const CREDIT_BUDGET = 100
export const MAX_PER_TEAM = 7

/**
 * Football positions come from team_players.role, which holds GK/DEF/MID/FWD
 * for football squads. Cricket's roles are auction tiers (Captain, Marquee,
 * Intermediate, Novice) rather than playing positions, so cricket gets no
 * quotas — see the spec for why.
 */
export const FOOTBALL_QUOTAS: Record<string, { min: number; max: number }> = {
  GK:  { min: 1, max: 1 },
  DEF: { min: 3, max: 5 },
  MID: { min: 3, max: 5 },
  FWD: { min: 1, max: 3 },
}

export interface SelectablePlayer {
  id: string
  name: string
  role: string
  credits: number | string
  team_id: string
}

export interface LineupSelection {
  playerIds: string[]
  captainId: string
  viceCaptainId: string
}

export interface LineupError {
  code: string
  message: string
}

const num = (v: number | string) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Total credits a selection costs. Unknown ids contribute nothing. */
export function lineupCost(playerIds: string[], pool: SelectablePlayer[]): number {
  const byId = new Map(pool.map(p => [p.id, p]))
  const total = playerIds.reduce((sum, id) => {
    const p = byId.get(id)
    return sum + (p ? num(p.credits) : 0)
  }, 0)
  return Math.round(total * 100) / 100
}

export function validateLineup(
  selection: LineupSelection,
  pool: SelectablePlayer[],
  sport: FantasySport,
): LineupError[] {
  const errors: LineupError[] = []
  const { playerIds, captainId, viceCaptainId } = selection
  const byId = new Map(pool.map(p => [p.id, p]))

  const unique = new Set(playerIds)
  if (unique.size !== playerIds.length) {
    errors.push({ code: 'DUPLICATE_PLAYER', message: 'The same player is picked more than once.' })
  }
  if (unique.size !== SQUAD_SIZE) {
    errors.push({ code: 'SQUAD_SIZE', message: `Pick exactly ${SQUAD_SIZE} players — you have ${unique.size}.` })
  }

  const unknown = [...unique].filter(id => !byId.has(id))
  if (unknown.length) {
    errors.push({ code: 'UNKNOWN_PLAYER', message: 'A pick is not in either squad for this match.' })
  }

  const cost = lineupCost([...unique], pool)
  if (cost > CREDIT_BUDGET) {
    errors.push({ code: 'OVER_BUDGET', message: `Over budget: ${cost} of ${CREDIT_BUDGET} credits.` })
  }

  const perTeam = new Map<string, number>()
  for (const id of unique) {
    const p = byId.get(id)
    if (!p) continue
    perTeam.set(p.team_id, (perTeam.get(p.team_id) ?? 0) + 1)
  }
  for (const [, count] of perTeam) {
    if (count > MAX_PER_TEAM) {
      errors.push({ code: 'MAX_PER_TEAM', message: `No more than ${MAX_PER_TEAM} players from one team.` })
      break
    }
  }

  if (!unique.has(captainId)) {
    errors.push({ code: 'CAPTAIN_NOT_IN_SQUAD', message: 'The captain must be one of your 11.' })
  }
  if (!unique.has(viceCaptainId)) {
    errors.push({ code: 'VICE_NOT_IN_SQUAD', message: 'The vice-captain must be one of your 11.' })
  }
  if (captainId && captainId === viceCaptainId) {
    errors.push({ code: 'CAPTAIN_IS_VICE', message: 'Captain and vice-captain must be different players.' })
  }

  if (sport === 'football') {
    const perRole = new Map<string, number>()
    for (const id of unique) {
      const p = byId.get(id)
      if (!p) continue
      perRole.set(p.role, (perRole.get(p.role) ?? 0) + 1)
    }
    for (const [role, { min, max }] of Object.entries(FOOTBALL_QUOTAS)) {
      const have = perRole.get(role) ?? 0
      if (have < min || have > max) {
        errors.push({
          code: `QUOTA_${role}`,
          message: min === max
            ? `Pick exactly ${min} ${role} — you have ${have}.`
            : `Pick ${min}–${max} ${role} — you have ${have}.`,
        })
      }
    }
  }

  return errors
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/fantasy/lineup.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Commit**

```bash
git add lib/fantasy/lineup.ts lib/fantasy/lineup.test.ts
git commit -m "feat: fantasy lineup validation — budget, team cap, football quotas"
```

---

## Task 5: Prize distribution

**Files:**
- Create: `lib/fantasy/prizes.ts`, `lib/fantasy/prizes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MIN_ENTRANTS`, `SPLIT_LARGE`, `SPLIT_SMALL`, `RankedEntry`, `PrizeAward`, `prizeSplits(entrants)`, `prizePool(entryFee, entrants, houseEdgePct)`, `distributePrizes(entries, pool)`

- [ ] **Step 1: Write the failing test**

Create `lib/fantasy/prizes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prizeSplits, prizePool, distributePrizes, MIN_ENTRANTS, type RankedEntry } from './prizes'

const e = (id: string, points: number): RankedEntry => ({ entry_id: id, user_id: 'u' + id, total_points: points })

describe('prizePool', () => {
  it('takes the house edge off the total fees', () => {
    expect(prizePool(100, 10, 5)).toBe(950)
  })

  it('copes with NUMERIC strings', () => {
    expect(prizePool('100.00' as never, 4, 5)).toBe(380)
  })
})

describe('prizeSplits', () => {
  it('pays the top 5 once there are 10 entrants', () => {
    expect(prizeSplits(10)).toEqual([40, 25, 15, 12, 8])
  })

  it('pays the top 3 between 4 and 9 entrants', () => {
    expect(prizeSplits(4)).toEqual([50, 30, 20])
    expect(prizeSplits(9)).toEqual([50, 30, 20])
  })

  it('returns null below the minimum, meaning void', () => {
    expect(prizeSplits(MIN_ENTRANTS - 1)).toBeNull()
    expect(prizeSplits(0)).toBeNull()
  })

  it('always sums to 100 percent', () => {
    for (const n of [4, 9, 10, 17, 50]) {
      const s = prizeSplits(n)!
      expect(s.reduce((a, b) => a + b, 0)).toBe(100)
    }
  })
})

describe('distributePrizes', () => {
  it('pays a clean top 3 in a 5-entrant contest', () => {
    const awards = distributePrizes(
      [e('a', 100), e('b', 90), e('c', 80), e('d', 70), e('e', 60)], 500)
    expect(awards.find(a => a.entry_id === 'a')).toMatchObject({ rank: 1, amount: 250 })
    expect(awards.find(a => a.entry_id === 'b')).toMatchObject({ rank: 2, amount: 150 })
    expect(awards.find(a => a.entry_id === 'c')).toMatchObject({ rank: 3, amount: 100 })
    expect(awards.find(a => a.entry_id === 'd')).toMatchObject({ rank: 4, amount: 0 })
  })

  it('splits the combined prize when two tie for second', () => {
    // places 2 and 3 are worth 30% + 20% = 50% of 500 = 250, so 125 each
    const awards = distributePrizes([e('a', 100), e('b', 90), e('c', 90), e('d', 70)], 500)
    expect(awards.find(a => a.entry_id === 'b')!.amount).toBe(125)
    expect(awards.find(a => a.entry_id === 'c')!.amount).toBe(125)
    expect(awards.find(a => a.entry_id === 'b')!.rank).toBe(2)
    expect(awards.find(a => a.entry_id === 'c')!.rank).toBe(2)
  })

  it('makes the player after a two-way tie for 2nd finish 4th', () => {
    const awards = distributePrizes([e('a', 100), e('b', 90), e('c', 90), e('d', 70)], 500)
    expect(awards.find(a => a.entry_id === 'd')!.rank).toBe(4)
  })

  it('handles everyone tying', () => {
    const awards = distributePrizes([e('a', 50), e('b', 50), e('c', 50), e('d', 50)], 400)
    for (const a of awards) {
      expect(a.rank).toBe(1)
      expect(a.amount).toBe(100)
    }
  })

  it('never pays out more than the pool', () => {
    const cases: RankedEntry[][] = [
      [e('a', 10), e('b', 10), e('c', 10), e('d', 10), e('e', 10)],
      [e('a', 3), e('b', 3), e('c', 1), e('d', 1), e('e', 1), e('f', 1), e('g', 0), e('h', 0), e('i', 0), e('j', 0)],
      Array.from({ length: 17 }, (_, i) => e('x' + i, i % 3)),
    ]
    for (const entries of cases) {
      const pool = 1000 / 3   // deliberately awkward
      const total = distributePrizes(entries, pool).reduce((s, a) => s + a.amount, 0)
      expect(total).toBeLessThanOrEqual(pool)
    }
  })

  it('rounds awards down so the remainder stays with the house', () => {
    // 3 tied for 1st in a 10-entrant split: places 1-3 = 80% of 100 = 80, /3 = 26.666…
    const entries = Array.from({ length: 10 }, (_, i) => e('p' + i, i < 3 ? 9 : 1))
    const awards = distributePrizes(entries, 100)
    const top = awards.filter(a => a.rank === 1)
    expect(top).toHaveLength(3)
    for (const a of top) expect(a.amount).toBe(26.66)
  })

  it('returns an empty list for an empty contest', () => {
    expect(distributePrizes([], 500)).toEqual([])
  })

  it('pays nobody when the contest is below the minimum', () => {
    const awards = distributePrizes([e('a', 100), e('b', 50)], 190)
    expect(awards.every(a => a.amount === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/fantasy/prizes.test.ts`
Expected: FAIL — cannot resolve `./prizes`

- [ ] **Step 3: Write the implementation**

Create `lib/fantasy/prizes.ts`:

```ts
/**
 * Contest ranking and prize distribution.
 *
 * Same pool discipline as the betting engine: fees pool, the house takes a
 * fixed edge, and the remainder is shared out — by rank here rather than by
 * outcome. Awards are rounded DOWN to the paisa so the total is provably
 * within the pool; rounding to nearest lets a few winners drift the sum above
 * it, which is how the betting settlement broke its own solvency invariant.
 */

/** Below this, there is no meaningful contest — entries are refunded. */
export const MIN_ENTRANTS = 4

export const SPLIT_LARGE = [40, 25, 15, 12, 8] as const  // 10+ entrants
export const SPLIT_SMALL = [50, 30, 20] as const         // 4-9 entrants

export interface RankedEntry {
  entry_id: string
  user_id: string
  total_points: number
}

export interface PrizeAward {
  entry_id: string
  user_id: string
  rank: number
  amount: number
}

const floor2 = (v: number) => Math.floor(v * 100) / 100

/** Percentage splits for a given field size, or null when the contest voids. */
export function prizeSplits(entrants: number): number[] | null {
  if (entrants < MIN_ENTRANTS) return null
  return entrants >= 10 ? [...SPLIT_LARGE] : [...SPLIT_SMALL]
}

/** Fees in, house edge off. */
export function prizePool(entryFee: number, entrants: number, houseEdgePct: number): number {
  const gross = Number(entryFee) * entrants
  return floor2(gross * (1 - Number(houseEdgePct) / 100))
}

/**
 * Rank by points descending and hand out the pool.
 *
 * Ties use standard competition ranking: two players tied for 2nd both rank
 * 2nd, share the money for places 2 and 3 equally, and the next player is 4th.
 */
export function distributePrizes(entries: RankedEntry[], pool: number): PrizeAward[] {
  if (entries.length === 0) return []

  const splits = prizeSplits(entries.length)
  const sorted = [...entries].sort((a, b) => b.total_points - a.total_points)

  // group equal scores together, preserving order
  const groups: RankedEntry[][] = []
  for (const entry of sorted) {
    const last = groups[groups.length - 1]
    if (last && last[0].total_points === entry.total_points) last.push(entry)
    else groups.push([entry])
  }

  const awards: PrizeAward[] = []
  let place = 1
  for (const group of groups) {
    const rank = place
    let share = 0
    if (splits) {
      // sum the percentages for every place this group occupies
      let pct = 0
      for (let i = place; i < place + group.length; i++) {
        pct += splits[i - 1] ?? 0
      }
      share = floor2((pool * pct) / 100 / group.length)
    }
    for (const entry of group) {
      awards.push({ entry_id: entry.entry_id, user_id: entry.user_id, rank, amount: share })
    }
    place += group.length
  }

  return awards
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/fantasy/prizes.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS — 25 existing + 47 new

```bash
git add lib/fantasy/prizes.ts lib/fantasy/prizes.test.ts
git commit -m "feat: fantasy prize distribution with tie handling"
```

---

## Task 6: Fantasy RPCs

**Files:**
- Create: `supabase/migrations/011_fantasy_rpcs.sql`

**Interfaces:**
- Consumes: tables from Task 2
- Produces: `enter_contest(p_user_id, p_contest_id, p_player_ids, p_captain_id, p_vice_captain_id) returns json`; `settle_contest(p_contest_id, p_awards jsonb, p_void boolean) returns json`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/011_fantasy_rpcs.sql`:

```sql
-- ============================================================
-- 011_fantasy_rpcs.sql
--
-- Money-moving RPCs for fantasy contests. Both follow the pattern the
-- betting rework arrived at the hard way:
--   * take the row lock FIRST, before reading anything that matters
--   * check status under that lock, so nothing settles twice
--   * validate that every payout row names a real entry in THIS contest
--     held by the CLAIMED user
--   * cap total payouts at the pool
--   * REVOKE from PUBLIC/anon/authenticated, GRANT only to service_role
-- Migration 007 omitted that last step and exposed an unbounded money
-- printer to anyone holding the public anon key.
-- ============================================================

-- ------------------------------------------------------------
-- enter_contest — join, or replace an existing lineup.
-- The fee is charged once, on first entry; editing is free until lock.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enter_contest(
  p_user_id          UUID,
  p_contest_id       UUID,
  p_player_ids       UUID[],
  p_captain_id       UUID,
  p_vice_captain_id  UUID
) RETURNS JSON AS $$
DECLARE
  v_status     contest_status;
  v_locks_at   TIMESTAMPTZ;
  v_fee        NUMERIC;
  v_balance    NUMERIC;
  v_entry_id   UUID;
  v_is_new     BOOLEAN := false;
BEGIN
  IF array_length(p_player_ids, 1) IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'A lineup must contain exactly 11 players';
  END IF;
  IF p_captain_id = p_vice_captain_id THEN
    RAISE EXCEPTION 'Captain and vice-captain must differ';
  END IF;
  IF NOT (p_captain_id = ANY(p_player_ids)) OR NOT (p_vice_captain_id = ANY(p_player_ids)) THEN
    RAISE EXCEPTION 'Captain and vice-captain must be in the lineup';
  END IF;
  IF (SELECT COUNT(DISTINCT x) FROM unnest(p_player_ids) x) <> 11 THEN
    RAISE EXCEPTION 'Duplicate player in lineup';
  END IF;

  SELECT status, locks_at, entry_fee
    INTO v_status, v_locks_at, v_fee
    FROM contests WHERE id = p_contest_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Contest not found';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Contest is not open';
  END IF;
  IF NOW() >= v_locks_at THEN
    RAISE EXCEPTION 'Contest has locked';
  END IF;

  SELECT id INTO v_entry_id
    FROM contest_entries WHERE contest_id = p_contest_id AND user_id = p_user_id;

  IF v_entry_id IS NULL THEN
    v_is_new := true;

    SELECT wallet_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Profile not found';
    END IF;
    IF v_balance < v_fee THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    UPDATE profiles SET wallet_balance = wallet_balance - v_fee WHERE id = p_user_id;

    INSERT INTO contest_entries (contest_id, user_id, captain_id, vice_captain_id)
    VALUES (p_contest_id, p_user_id, p_captain_id, p_vice_captain_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (p_user_id, 'fantasy_entry', -v_fee, 'Fantasy contest entry', v_entry_id);

    UPDATE contests
      SET prize_pool = ROUND((entry_fee * (SELECT COUNT(*) FROM contest_entries WHERE contest_id = p_contest_id))
                             * (1 - house_edge_pct / 100), 2)
      WHERE id = p_contest_id;
  ELSE
    UPDATE contest_entries
      SET captain_id = p_captain_id, vice_captain_id = p_vice_captain_id, updated_at = NOW()
      WHERE id = v_entry_id;
  END IF;

  DELETE FROM entry_players WHERE entry_id = v_entry_id;
  INSERT INTO entry_players (entry_id, player_id)
  SELECT v_entry_id, x FROM unnest(p_player_ids) x;

  RETURN json_build_object('entry_id', v_entry_id, 'charged', v_is_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- settle_contest — one-time. Points and awards are computed by
-- lib/fantasy/prizes.ts and passed in; this applies them atomically.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_contest(
  p_contest_id UUID,
  p_awards     JSONB,   -- [{entry_id, user_id, rank, amount}]
  p_void       BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_status  contest_status;
  v_pool    NUMERIC;
  v_total   NUMERIC := 0;
  v_bad     INT;
  v_row     JSONB;
  v_count   INT := 0;
BEGIN
  SELECT status, prize_pool INTO v_status, v_pool
    FROM contests WHERE id = p_contest_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Contest not found';
  END IF;
  IF v_status IN ('settled', 'void') THEN
    RAISE EXCEPTION 'Contest already settled';
  END IF;

  -- every award must name a real entry in THIS contest, held by the
  -- claimed user, for a non-negative amount
  SELECT COUNT(*) INTO v_bad
    FROM jsonb_array_elements(p_awards) a
    WHERE NOT EXISTS (
      SELECT 1 FROM contest_entries e
      WHERE e.id = (a->>'entry_id')::UUID
        AND e.contest_id = p_contest_id
        AND e.user_id = (a->>'user_id')::UUID
    ) OR (a->>'amount')::NUMERIC < 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Award references an entry that is not in this contest';
  END IF;

  SELECT COUNT(*) INTO v_bad
    FROM (SELECT (a->>'entry_id') AS e FROM jsonb_array_elements(p_awards) a
          GROUP BY 1 HAVING COUNT(*) > 1) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Duplicate entry in awards';
  END IF;

  SELECT COALESCE(SUM((a->>'amount')::NUMERIC), 0) INTO v_total
    FROM jsonb_array_elements(p_awards) a;

  -- on a void we hand back exactly the fees, which exceed the edged pool
  IF NOT p_void AND v_total > v_pool + 0.01 THEN
    RAISE EXCEPTION 'Awards % exceed prize pool %', v_total, v_pool;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_awards)
  LOOP
    IF (v_row->>'amount')::NUMERIC > 0 THEN
      UPDATE profiles
        SET wallet_balance = wallet_balance + (v_row->>'amount')::NUMERIC
        WHERE id = (v_row->>'user_id')::UUID;

      INSERT INTO transactions (user_id, type, amount, description, reference_id)
      VALUES (
        (v_row->>'user_id')::UUID,
        CASE WHEN p_void THEN 'refund'::transaction_type ELSE 'fantasy_prize'::transaction_type END,
        (v_row->>'amount')::NUMERIC,
        CASE WHEN p_void THEN 'Fantasy contest voided — entry refunded'
             ELSE 'Fantasy prize — rank ' || COALESCE(v_row->>'rank', '?') END,
        (v_row->>'entry_id')::UUID
      );
    END IF;

    UPDATE contest_entries
      SET rank = NULLIF(v_row->>'rank', '')::INT,
          payout = (v_row->>'amount')::NUMERIC,
          updated_at = NOW()
      WHERE id = (v_row->>'entry_id')::UUID;

    v_count := v_count + 1;
  END LOOP;

  UPDATE contests
    SET status = CASE WHEN p_void THEN 'void'::contest_status ELSE 'settled'::contest_status END
    WHERE id = p_contest_id;

  RETURN json_build_object('settled', v_count, 'total_paid', v_total, 'void', p_void);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Lock both down. They are only ever called through createAdminClient().
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION enter_contest(UUID, UUID, UUID[], UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enter_contest(UUID, UUID, UUID[], UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION settle_contest(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_contest(UUID, JSONB, BOOLEAN) TO service_role;
```

- [ ] **Step 2: Apply it**

Run: `SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-migration.mjs supabase/migrations/011_fantasy_rpcs.sql`
Expected: `OK: []`

- [ ] **Step 3: Prove the lockdown, in both directions**

Write a throwaway script that:
1. calls `enter_contest` and `settle_contest` with `NEXT_PUBLIC_SUPABASE_ANON_KEY` — each must return a permission error (`42501`) or 404, never 200;
2. calls both with `SUPABASE_SERVICE_ROLE_KEY` against a nonexistent contest id — each must fail with the *business* error `Contest not found` (`P0001`), which proves EXECUTE was granted rather than over-revoked.

Paste both outputs into the report, then delete the throwaway.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_fantasy_rpcs.sql
git commit -m "feat: fantasy RPCs — guarded entry and one-time settlement"
```

---

## Task 7: API routes

**Files:**
- Create: `app/api/admin/contests/route.ts`, `app/api/fantasy/squad/route.ts`, `app/api/fantasy/entry/route.ts`, `app/api/fantasy/leaderboard/route.ts`, `app/api/admin/fantasy/stats/route.ts`, `app/api/admin/fantasy/settle/route.ts`

**Interfaces:**
- Consumes: `validateLineup`, `lineupCost` (Task 4); `entryPoints` (Task 3); `distributePrizes`, `prizePool` (Task 5); both RPCs (Task 6)
- Produces: the HTTP surface the UI tasks consume

Every route follows the existing conventions in `app/api/admin/markets/route.ts`: Zod validation, a local `verifyAdmin()` for admin routes, `createServerSupabaseClient()` for the caller's identity, `createAdminClient()` for privileged work.

- [ ] **Step 1: Squad route — the selectable pool**

`GET /api/fantasy/squad?matchId=<uuid>` returns `{ sport, teams: [{id,name}], players: SelectablePlayer[], budget, squadSize }`.

Resolve the pool exactly as `app/api/admin/players/route.ts` does: read the match to get `sport`, `team_a`, `team_b`; then
`teams` where `name IN (team_a, team_b) AND sport = match.sport AND category = 'mens'`, embedding `team_players(id, name, role, credits)`. Attach each player's `team_id`. Return 400 if the sport is not cricket or football. Sort players by `credits` descending, then name.

- [ ] **Step 2: Entry route — join or edit**

`POST /api/fantasy/entry` with body `{ contest_id, player_ids: string[], captain_id, vice_captain_id }`.

1. Require an authenticated user.
2. Load the contest and its match; reject unless `status = 'open'` and `now < locks_at`.
3. Rebuild the selectable pool server-side (never trust a client-supplied pool) and run `validateLineup`. On any error return `400 { errors }`.
4. Call `enter_contest` through the admin client with `user.id` — never a user id from the request body.
5. Return `{ success: true, entry_id, charged }`.

`GET /api/fantasy/entry?contestId=<uuid>` returns the caller's own entry with its player ids, or `{ entry: null }`.

- [ ] **Step 3: Leaderboard route**

`GET /api/fantasy/leaderboard?contestId=<uuid>` returns `{ status, entries: [{ display_name, total_points, rank, payout, is_you }] }`.

**Return no lineup data.** When `status = 'open'`, return entrant count and the caller's own row only — revealing standings before lock would leak team composition by inference.

- [ ] **Step 4: Admin contests route**

`POST /api/admin/contests` `{ match_id, entry_fee?, house_edge_pct? }` — creates one contest, defaulting `entry_fee` to 100, `house_edge_pct` to 5, and `locks_at` to the match's `match_date`. Reject if the match's sport is not cricket or football. Rely on the `UNIQUE (match_id)` constraint and translate a 23505 into a friendly 409.

`PATCH` updates `entry_fee`, `locks_at` or `status` while the contest is still `open` and has no entries. `DELETE` removes a contest that has no entries; refuse otherwise with 409 (refunding entrants is out of scope for v1 — say so in the error message).

- [ ] **Step 5: Admin stats route — idempotent, moves no money**

`POST /api/admin/fantasy/stats` `{ match_id, stats: PlayerStats[] }`.

1. Upsert every row into `player_match_stats` on `(match_id, player_id)`.
2. Reload all stats for the match, build the `Map`, and for every entry in the match's contest recompute `total_points` with `entryPoints`.
3. Write `total_points` back. Do **not** touch `rank`, `payout`, wallets or `contests.status`.
4. Return `{ saved: n, entries_scored: m }`.

This is safe to call as often as the admin likes — that is the whole point of separating it from settlement.

- [ ] **Step 6: Admin settle route — one-time**

`POST /api/admin/fantasy/settle` `{ contest_id }`.

1. Load the contest with its entries.
2. If `entries.length < MIN_ENTRANTS`, build refund awards of exactly `entry_fee` each and call `settle_contest` with `p_void = true`.
3. Otherwise compute `distributePrizes(entries, contest.prize_pool)` and call with `p_void = false`.
4. Return `{ success, void, total_paid }`.

Refuse with 400 if any entry still has a null `total_points` — settling before stats are saved would rank everyone at zero and pay the wrong people.

- [ ] **Step 7: Verify and commit**

Run: `npm run build` (must succeed) and `npm test` (must still pass).

```bash
git add app/api
git commit -m "feat: fantasy API — squad, entry, leaderboard, stats, settlement"
```

---

## Task 8: Navigation and contest pages

**Files:**
- Modify: `app/sports/[sport]/page.tsx`
- Create: `app/sports/[sport]/betting/page.tsx`, `app/sports/[sport]/fantasy/page.tsx`
- Modify: `lib/sports.ts`

**Interfaces:**
- Consumes: `/api/admin/contests` data shape from Task 7
- Produces: the route skeleton Task 9 hangs the builder on

- [ ] **Step 1: Add the fantasy-sport predicate**

Append to `lib/sports.ts`:

```ts
/** Sports that additionally offer a Dream11-style fantasy league. */
export const FANTASY_SPORTS = ['cricket', 'football'] as const
export type FantasySportType = typeof FANTASY_SPORTS[number]
export const hasFantasy = (sport: string): sport is FantasySportType =>
  (FANTASY_SPORTS as readonly string[]).includes(sport)
```

- [ ] **Step 2: Move the match list to `/sports/[sport]/betting`**

Copy the current body of `app/sports/[sport]/page.tsx` verbatim into `app/sports/[sport]/betting/page.tsx`, changing only the back-link: for a fantasy sport it points at `/sports/${sport}` (the chooser); otherwise `/`. Match cards keep linking to `/sports/${sport}/${match.id}`.

- [ ] **Step 3: Turn `/sports/[sport]` into the mode chooser**

Rewrite `app/sports/[sport]/page.tsx`: if `!hasFantasy(sport)`, `redirect(\`/sports/${sport}/betting\`)`. Otherwise render two large cards, thumb-reachable and stacked on mobile, side by side from `sm:`:

- **Betting** → `/sports/${sport}/betting` — subtitle "Back an outcome. Winners share the pool." Show the count of open markets.
- **Fantasy** → `/sports/${sport}/fantasy` — subtitle "Pick 11. Score points. Top ranks win." Show the count of contests open for entry.

Reuse the `bg-table` / `border-rail` / `hover:border-amber/50` card treatment from the existing `MatchCard`.

- [ ] **Step 4: Contest list page**

`app/sports/[sport]/fantasy/page.tsx` lists this sport's contests joined to their match, split into **Open for entry** (`status = 'open'` and `locks_at` in the future), **In play** (locked, not settled) and **Completed**. Each row shows the fixture, lock time via `date-fns`, entry fee, entrant count and current prize pool, linking to `/sports/${sport}/fantasy/${match_id}`.

Empty state: "No fantasy contests yet." — do not imply the feature is broken.

- [ ] **Step 5: Verify and commit**

Run `npm run build`, then check every route resolves: `/sports/cricket` shows the chooser, `/sports/pool` redirects to betting, `/sports/cricket/betting` shows matches, and an existing match detail URL still works.

```bash
git add app/sports lib/sports.ts
git commit -m "feat: fantasy/betting mode chooser and contest list"
```

---

## Task 9: Team builder

**Files:**
- Create: `components/fantasy/TeamBuilder.tsx`, `app/sports/[sport]/fantasy/[matchId]/page.tsx`

**Interfaces:**
- Consumes: `/api/fantasy/squad`, `/api/fantasy/entry` (Task 7); `validateLineup`, `lineupCost`, `CREDIT_BUDGET`, `SQUAD_SIZE`, `MAX_PER_TEAM` (Task 4)
- Produces: nothing downstream

- [ ] **Step 1: Page shell**

`app/sports/[sport]/fantasy/[matchId]/page.tsx` is a server component that loads the match and its contest, plus the caller's existing entry if any. If no contest exists, show "No contest for this match yet." If the contest has locked, render `ContestLeaderboard` (Task 11) instead of the builder. Otherwise render `<TeamBuilder>` with the contest, the squad payload and any existing entry as props.

- [ ] **Step 2: Builder component**

`components/fantasy/TeamBuilder.tsx` is a client component holding `selected: Set<string>`, `captainId` and `viceCaptainId`.

Layout, mobile-first:
- **Sticky header** — credits used out of 100 as a bar plus `X/11 picked`. Turns `text-crimson-light` when over budget.
- **Two team columns** (stacked on mobile, `sm:grid-cols-2`), each headed by the team name and a `n/7` counter.
- **Player row** — name, role, credits, and a tap target covering the whole row. Selected rows get `border-amber bg-amber/10`. A row that cannot legally be added (would breach 11, the budget, or the per-team cap) renders at `opacity-50` and does not respond, so the rules are discoverable without an error message.
- **Captain / vice-captain pickers** appear once 11 are chosen: two rows of chips built from the selection, C and VC mutually exclusive.
- **Validation checklist** — run `validateLineup` on every change and list outstanding `LineupError.message` values. Submit stays disabled while any remain.
- **Submit** — POSTs to `/api/fantasy/entry`. On success show "You're in — ₹{fee} entry" and switch the button to "Update lineup" for repeat edits before lock. Surface server-returned `errors` verbatim; the server is the authority and may reject something the client allowed.

Show the entry fee and the user's balance near the submit button, and disable submission with "Not enough balance" when `balance < fee` and no entry exists yet.

- [ ] **Step 3: Verify and commit**

Run `npm run build`. Manually confirm: selecting 11 within budget enables submit; an 8th player from one team is unselectable; removing a player re-enables the rest.

```bash
git add components/fantasy app/sports
git commit -m "feat: fantasy team builder"
```

---

## Task 10: Admin contest management and stat entry

**Files:**
- Create: `components/admin/StatEntry.tsx`
- Modify: `app/admin/matches/page.tsx`

**Interfaces:**
- Consumes: `/api/admin/contests`, `/api/admin/fantasy/stats`, `/api/admin/fantasy/settle` (Task 7)
- Produces: nothing downstream

- [ ] **Step 1: Contest controls on the match row**

In `app/admin/matches/page.tsx`, for cricket and football matches only, add a **Fantasy** block beside the existing markets block:
- No contest → a "Create contest" button with an entry-fee input defaulting to 100.
- Contest exists → show status, entrant count, prize pool, and buttons for **Enter stats** and **Settle contest**.
- Settle is disabled unless the contest is past `locks_at` and every entry has points. Its `confirm()` must state that settlement is final and pays real balances.

Follow the file's existing state and fetch patterns rather than introducing a new data layer.

- [ ] **Step 2: Stat entry grid**

`components/admin/StatEntry.tsx` loads both squads from `/api/fantasy/squad`, and existing rows from `player_match_stats`.

- One card per player, grouped by team, home team first.
- A **Played** toggle. While off, the stat inputs are hidden — an unplayed player scores zero regardless.
- Five steppers for the sport: cricket → Runs, Wickets, Catches, Sixes, Run-outs; football → Goals, Assists, Saves, Clean sheet (toggle), Cards (yellow and red steppers).
- Steppers are `−` / value / `+` buttons at a minimum 44px tap target. Runs also gets a numeric input, since typing 47 beats tapping it.
- A running **points preview** per player using `playerPoints`, so the scorer can sanity-check as they go.
- **Save** posts the whole set. Show "Saved — points recalculated" and the number of entries rescored. Saving is safe to repeat.

- [ ] **Step 3: Verify and commit**

Run `npm run build`.

```bash
git add components/admin app/admin
git commit -m "feat: admin fantasy contest controls and stat entry"
```

---

## Task 11: Leaderboard and verification gate

**Files:**
- Create: `components/fantasy/ContestLeaderboard.tsx`, `scripts/verify-fantasy.mjs`

**Interfaces:**
- Consumes: `/api/fantasy/leaderboard` (Task 7)
- Produces: a repeatable pre-deploy gate

- [ ] **Step 1: Leaderboard component**

Rank, display name, points and payout, with the caller's own row highlighted `border-amber`. Before lock, show only the entrant count and "Standings appear once the contest locks." Tied ranks display the shared rank number.

- [ ] **Step 2: Verification gate**

`scripts/verify-fantasy.mjs`, following the `.env.local` pattern in `scripts/verify.mjs` and exiting non-zero on any failure:

- All four fantasy tables exist and are selectable with the service-role key.
- `enter_contest` and `settle_contest` are **rejected** with the anon key.
- `contest_entries` returns nothing for an anon caller.
- For every settled contest, `sum(payout) <= prize_pool + 0.01`.
- No contest has more entries than `prize_pool / entry_fee / 0.95` would imply, allowing a paisa of rounding.
- Every entry has exactly 11 rows in `entry_players`.
- Production data is unchanged: 17 profiles, and wallet total unchanged from before the deploy.

- [ ] **Step 3: Run every gate and commit**

Run: `npm test && npm run build && node scripts/verify.mjs && node scripts/verify-parimutuel.mjs && node scripts/verify-fantasy.mjs`
Expected: all pass, all exit 0.

```bash
git add components/fantasy scripts/verify-fantasy.mjs
git commit -m "feat: contest leaderboard and fantasy verification gate"
```

---

## Manual smoke test

Automated checks cannot confirm the felt experience. After Task 11:

1. As admin, create a contest on an upcoming cricket fixture at ₹100.
2. As a user with balance, open `/sports/cricket`, choose **Fantasy**, open the contest.
3. Confirm you cannot pick an 8th player from one team, and cannot exceed 100 credits.
4. Submit a legal XI. Confirm ₹100 leaves the wallet and the ledger shows a `fantasy_entry` row.
5. Edit the lineup before lock. Confirm the wallet does **not** move a second time.
6. As admin, enter stats for both squads and save. Confirm points appear and re-saving changes nothing but the numbers.
7. Settle the contest. Confirm prizes land, the ledger shows `fantasy_prize`, and settling again is refused.
8. With fewer than 4 entrants, confirm settlement voids and refunds instead of paying.

## Out of scope

Season-long fantasy standings, multiple contests per match, live in-play substitutions, fantasy for the other four sports, refunding entrants on contest deletion, and cricket positional quotas (see the spec's open questions).

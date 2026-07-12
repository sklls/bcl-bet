# Multi-Sport Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand BCL Bet from cricket-only to a 6-sport hub (cricket, football, table tennis, volleyball, pool, basketball) with sport-specific markets, a teams management system, sport landing pages at `/sports/[sport]`, and a season reset.

**Architecture:** Add a `sport_type` enum and `teams` table to Supabase; add a `sport` column to `matches`; route each sport's matches through `/sports/[sport]`. The homepage becomes a sport-selection hub. All existing betting components (BetSlip, MarketsSection) are reused unchanged.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), Tailwind CSS, TypeScript, date-fns.

## Global Constraints

- All Tailwind colours use BITSoM palette: bg `#0D1730`, card `#162244`, hover `#1E2E52`, border `#243568`, orange `#F07820`, red `#C41E28`, muted `#7a91c4`.
- All new API routes must call `verifyAdmin()` before any mutation.
- No live score features — no CricHeroes, no `live_score_*` fields anywhere.
- `sport` values are the literal DB enum strings: `cricket`, `football`, `table_tennis`, `volleyball`, `pool`, `basketball`.
- Match detail links pattern: `/sports/${sport}/${matchId}`.

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/002_multisport.sql`

**Notes:** Run this SQL in the Supabase SQL Editor (Dashboard → SQL Editor → New query). There is no migration runner configured. Run it once, then verify in Table Editor that `teams` exists and `matches` has a `sport` column.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/002_multisport.sql`:

```sql
-- ============================================================
-- 002_multisport.sql — Run in Supabase SQL Editor
-- ============================================================

-- 1. Sport type enum
CREATE TYPE sport_type AS ENUM (
  'cricket', 'football', 'table_tennis', 'volleyball', 'pool', 'basketball'
);

-- 2. Teams table
CREATE TABLE teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  sport sport_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view teams" ON teams FOR SELECT USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE teams;

-- 3. Add sport column to matches (existing rows become 'cricket')
ALTER TABLE matches ADD COLUMN sport sport_type NOT NULL DEFAULT 'cricket';

-- 4. Drop cricket-specific columns
ALTER TABLE matches
  DROP COLUMN IF EXISTS cricheroes_match_id,
  DROP COLUMN IF EXISTS cricheroes_slug,
  DROP COLUMN IF EXISTS live_score_a,
  DROP COLUMN IF EXISTS live_score_b,
  DROP COLUMN IF EXISTS live_overs_a,
  DROP COLUMN IF EXISTS live_overs_b,
  DROP COLUMN IF EXISTS live_crr,
  DROP COLUMN IF EXISTS live_rrr,
  DROP COLUMN IF EXISTS over_under_line;

-- 5. New market_type enum values
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'first_goal_scorer';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'set_winner';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'handicap';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'frame_handicap';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'custom';

-- 6. Season reset RPC (deletes all match/bet/team data, zeros wallets)
CREATE OR REPLACE FUNCTION reset_season() RETURNS VOID AS $$
BEGIN
  DELETE FROM bets;              -- remove before markets (no CASCADE on FK)
  DELETE FROM matches;           -- cascades: markets, bet_options, players
  DELETE FROM teams;
  DELETE FROM transactions;
  UPDATE profiles SET wallet_balance = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Run it in Supabase SQL Editor**

Paste the SQL above in Supabase Dashboard → SQL Editor → Run. Expect: "Success. No rows returned."

- [ ] **Step 3: Verify in Supabase Table Editor**

- Table `teams` exists with columns: `id`, `name`, `sport`, `created_at`
- Table `matches` has column `sport` (type `sport_type`)
- Table `matches` does NOT have `cricheroes_match_id` or `live_score_a`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_multisport.sql
git commit -m "feat: multisport DB migration — teams table, sport column, new market types"
```

---

### Task 2: Sports Constants

**Files:**
- Create: `lib/sports.ts`

**Interfaces:**
- Produces: `SPORTS`, `SPORT_MARKETS`, `SportType`, `ALL_SPORTS` — used by every subsequent task.

- [ ] **Step 1: Create `lib/sports.ts`**

```ts
export const SPORTS = {
  cricket:      { label: 'Cricket',      emoji: '🏏' },
  football:     { label: 'Football',     emoji: '⚽' },
  table_tennis: { label: 'Table Tennis', emoji: '🏓' },
  volleyball:   { label: 'Volleyball',   emoji: '🏐' },
  pool:         { label: 'Pool',         emoji: '🎱' },
  basketball:   { label: 'Basketball',   emoji: '🏀' },
} as const

export type SportType = keyof typeof SPORTS

export const ALL_SPORTS = Object.keys(SPORTS) as SportType[]

export const SPORT_MARKETS: Record<SportType, { value: string; label: string }[]> = {
  cricket: [
    { value: 'winner',      label: 'Match Winner' },
    { value: 'top_scorer',  label: 'Top Scorer' },
    { value: 'over_under',  label: 'Over / Under' },
    { value: 'custom',      label: 'Custom' },
  ],
  football: [
    { value: 'winner',              label: 'Match Winner' },
    { value: 'first_goal_scorer',   label: 'First Goal Scorer' },
    { value: 'over_under',          label: 'Over / Under (Goals)' },
    { value: 'custom',              label: 'Custom' },
  ],
  table_tennis: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'set_winner', label: 'Set Winner' },
    { value: 'handicap',   label: 'Handicap' },
    { value: 'custom',     label: 'Custom' },
  ],
  volleyball: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'set_winner', label: 'Set Winner' },
    { value: 'custom',     label: 'Custom' },
  ],
  pool: [
    { value: 'winner',          label: 'Match Winner' },
    { value: 'frame_handicap',  label: 'Frame Handicap' },
    { value: 'custom',          label: 'Custom' },
  ],
  basketball: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'over_under', label: 'Over / Under (Points)' },
    { value: 'handicap',   label: 'Handicap' },
    { value: 'custom',     label: 'Custom' },
  ],
}

// Markets that use the player-picker UI (populated from /api/admin/players)
export const PLAYER_PICKER_MARKETS = new Set(['top_scorer', 'first_goal_scorer'])
```

- [ ] **Step 2: Commit**

```bash
git add lib/sports.ts
git commit -m "feat: sports constants (SPORTS, SPORT_MARKETS, SportType)"
```

---

### Task 3: Teams API Routes

**Files:**
- Create: `app/api/admin/teams/route.ts`
- Create: `app/api/admin/teams/[id]/route.ts`

**Interfaces:**
- Consumes: `verifyAdmin()` pattern from existing API routes
- Produces: `GET /api/admin/teams?sport=<sport>`, `POST /api/admin/teams`, `DELETE /api/admin/teams/:id`

- [ ] **Step 1: Create `app/api/admin/teams/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const TeamSchema = z.object({
  name: z.string().min(1),
  sport: z.enum(['cricket', 'football', 'table_tennis', 'volleyball', 'pool', 'basketball']),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function GET(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')

  const admin = createAdminClient()
  let query = admin.from('teams').select('*').order('name')
  if (sport) query = query.eq('sport', sport)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = TeamSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('teams').insert(parsed.data).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Create `app/api/admin/teams/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin.from('teams').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/teams/route.ts app/api/admin/teams/[id]/route.ts
git commit -m "feat: teams API routes (GET, POST, DELETE)"
```

---

### Task 4: Season Reset API + FinancialOverview Update

**Files:**
- Create: `app/api/admin/reset-season/route.ts`
- Modify: `components/admin/FinancialOverview.tsx`

- [ ] **Step 1: Create `app/api/admin/reset-season/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function POST() {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin.rpc('reset_season')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Update `components/admin/FinancialOverview.tsx`**

Replace the `loading` state type and `handleReset` function, and update the button section. The "Reset Cash Counter" stays unchanged. Replace "Full Reset" with "Season Reset".

Change the `loading` type from `'cash' | 'full' | null` to `'cash' | 'season' | null`:

```tsx
const [loading, setLoading] = useState<'cash' | 'season' | null>(null)
```

Replace the `handleReset` function entirely:

```tsx
async function handleReset(type: 'cash' | 'season') {
  if (type === 'cash') {
    if (!window.confirm(
      'Reset "Total Cash Collected" to ₹0?\n\nThis deletes all top-up transaction records. Wallets and bet history are NOT affected.'
    )) return

    setLoading('cash')
    setMsg('')
    try {
      const res = await fetch('/api/admin/reset-financials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cash' }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg('✅ Cash collected counter reset to ₹0.')
        setMsgType('success')
        setTimeout(() => window.location.reload(), 800)
      } else {
        setMsg(`Error: ${data.error ?? JSON.stringify(data)}`)
        setMsgType('error')
      }
    } catch (err) {
      setMsg(`Network error: ${String(err)}`)
      setMsgType('error')
    } finally {
      setLoading(null)
    }
    return
  }

  // Season reset
  const input = window.prompt(
    '⚠️ SEASON RESET ⚠️\n\nThis will:\n• Delete ALL matches, markets, bets\n• Delete ALL teams\n• Zero ALL user wallets\n• Delete ALL transactions\n\nThis CANNOT be undone. Type RESET SEASON to confirm.'
  )
  if (input !== 'RESET SEASON') {
    setMsg('Reset cancelled.')
    setMsgType('error')
    return
  }

  setLoading('season')
  setMsg('')
  try {
    const res = await fetch('/api/admin/reset-season', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setMsg('✅ Season reset complete. All matches, teams, and transactions cleared.')
      setMsgType('success')
      setTimeout(() => window.location.reload(), 800)
    } else {
      setMsg(`Error: ${data.error ?? JSON.stringify(data)}`)
      setMsgType('error')
    }
  } catch (err) {
    setMsg(`Network error: ${String(err)}`)
    setMsgType('error')
  } finally {
    setLoading(null)
  }
}
```

Replace the two buttons in the JSX:

```tsx
<button
  onClick={() => handleReset('cash')}
  disabled={loading !== null}
  className="px-3 py-1.5 text-xs font-medium bg-[#1E2E52] hover:bg-[#243568] text-[#7a91c4] border border-[#243568] rounded-lg transition-colors disabled:opacity-50"
>
  {loading === 'cash' ? 'Resetting…' : 'Reset Cash Counter'}
</button>
<button
  onClick={() => handleReset('season')}
  disabled={loading !== null}
  className="px-3 py-1.5 text-xs font-medium bg-[#C41E28]/10 hover:bg-[#C41E28]/20 text-[#C41E28] border border-[#C41E28]/30 rounded-lg transition-colors disabled:opacity-50"
>
  {loading === 'season' ? 'Resetting…' : '🔄 Season Reset'}
</button>
```

Update the legend at the bottom of the component:

```tsx
<div className="mt-3 text-xs text-[#5a7099] space-y-0.5">
  <p><span className="text-[#7a91c4]">Reset Cash Counter</span> — clears top-up records only. Wallets &amp; bets untouched.</p>
  <p><span className="text-[#C41E28]">Season Reset</span> — deletes all matches, teams, transactions; zeros all wallets.</p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/reset-season/route.ts components/admin/FinancialOverview.tsx
git commit -m "feat: season reset API and admin UI"
```

---

### Task 5: Delete Dead Code

**Files:**
- Delete: `app/api/cricheroes/route.ts`
- Delete: `app/api/cron/sync-scores/route.ts`
- Delete: `components/betting/LiveScoreCard.tsx`
- Delete: `app/matches/[id]/page.tsx`
- Delete: `app/teams/page.tsx`
- Modify: `vercel.json` (remove cron entry)

- [ ] **Step 1: Delete files**

```bash
git rm app/api/cricheroes/route.ts
git rm app/api/cron/sync-scores/route.ts
git rm components/betting/LiveScoreCard.tsx
git rm "app/matches/[id]/page.tsx"
git rm app/teams/page.tsx
```

- [ ] **Step 2: Update `vercel.json` to remove cron**

Open `vercel.json`. Remove the entire `"crons"` array so the file becomes:

```json
{}
```

(Or if there are other settings in vercel.json, only remove the `"crons"` key.)

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "chore: remove CricHeroes, cron sync, LiveScoreCard, old match route"
```

---

### Task 6: Update Matches API

**Files:**
- Modify: `app/api/admin/matches/route.ts`

Remove `over_under_line` and `cricheroes_url` from the schema. Add `sport`. Remove CricHeroes URL parsing logic from POST.

- [ ] **Step 1: Replace `app/api/admin/matches/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const MatchSchema = z.object({
  team_a: z.string().min(1),
  team_b: z.string().min(1),
  match_date: z.string(),
  venue: z.string().optional(),
  sport: z.enum(['cricket', 'football', 'table_tennis', 'volleyball', 'pool', 'basketball']),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function GET() {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('matches')
    .select('*, markets(id, market_type, title, status, result, bet_options(id, label, total_amount_bet, bets(id, user_id, amount, status, placed_at, profiles(display_name))))')
    .order('match_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = MatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('matches')
    .insert(parsed.data)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('id')
  if (!matchId) return NextResponse.json({ error: 'Missing match id' }, { status: 400 })

  const admin = createAdminClient()

  const { data: pendingBets } = await admin
    .from('bets')
    .select('id, user_id, amount, market_id, markets!inner(match_id)')
    .eq('markets.match_id', matchId)
    .eq('status', 'pending')

  if (pendingBets && pendingBets.length > 0) {
    for (const bet of pendingBets) {
      await admin.rpc('topup_wallet', {
        p_user_id: bet.user_id,
        p_amount: bet.amount,
        p_description: 'Refund: match deleted by admin',
      })
      await admin.from('bets').update({ status: 'void' }).eq('id', bet.id)
    }
  }

  const { error } = await admin.from('matches').delete().eq('id', matchId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, refunded: pendingBets?.length ?? 0 })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/matches/route.ts
git commit -m "feat: matches API — add sport field, remove CricHeroes"
```

---

### Task 7: Admin Teams Page

**Files:**
- Create: `app/admin/teams/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/teams?sport=`, `POST /api/admin/teams`, `DELETE /api/admin/teams/:id`
- Consumes: `SPORTS`, `ALL_SPORTS`, `SportType` from `@/lib/sports`

- [ ] **Step 1: Create `app/admin/teams/page.tsx`**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { SPORTS, ALL_SPORTS, SportType } from '@/lib/sports'

type Team = { id: string; name: string; sport: SportType }

export default function AdminTeamsPage() {
  const [activeSport, setActiveSport] = useState<SportType>('cricket')
  const [teams, setTeams] = useState<Team[]>([])
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const loadTeams = useCallback(async () => {
    const res = await fetch(`/api/admin/teams?sport=${activeSport}`)
    if (res.ok) setTeams(await res.json())
  }, [activeSport])

  useEffect(() => { loadTeams() }, [loadTeams])

  async function addTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    const res = await fetch('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), sport: activeSport }),
    })
    if (res.ok) {
      setNewName('')
      setMsg(`Team added to ${SPORTS[activeSport].label}.`)
      loadTeams()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error adding team')
    }
    setLoading(false)
  }

  async function deleteTeam(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/teams/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMsg(`"${name}" deleted.`)
      loadTeams()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error deleting team')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Manage Teams</h1>
        <p className="text-[#7a91c4] text-sm mt-1">Add teams per sport before creating matches</p>
      </div>

      {msg && (
        <p className="text-sm px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-[#7a91c4]">
          {msg}
        </p>
      )}

      {/* Sport tabs */}
      <div className="flex flex-wrap gap-2">
        {ALL_SPORTS.map(sport => (
          <button
            key={sport}
            onClick={() => { setActiveSport(sport); setMsg('') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSport === sport
                ? 'bg-[#F07820] text-white'
                : 'bg-[#162244] text-[#7a91c4] border border-[#243568] hover:border-[#F07820]/50'
            }`}
          >
            {SPORTS[sport].emoji} {SPORTS[sport].label}
          </button>
        ))}
      </div>

      {/* Add team form */}
      <form onSubmit={addTeam} className="flex gap-2">
        <input
          required
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder={`New ${SPORTS[activeSport].label} team name`}
          className="flex-1 px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[#F07820] hover:bg-[#D96A18] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          + Add
        </button>
      </form>

      {/* Teams list */}
      <div className="space-y-2">
        {teams.length === 0 ? (
          <p className="text-[#5a7099] text-sm py-6 text-center">
            No {SPORTS[activeSport].label} teams yet. Add one above.
          </p>
        ) : (
          teams.map(team => (
            <div
              key={team.id}
              className="flex items-center justify-between bg-[#162244] border border-[#243568] rounded-lg px-4 py-3"
            >
              <span className="text-white text-sm font-medium">{team.name}</span>
              <button
                onClick={() => deleteTeam(team.id, team.name)}
                className="text-xs px-2 py-1 bg-[#C41E28]/10 hover:bg-[#C41E28]/20 text-[#C41E28] rounded transition-colors"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/teams/page.tsx
git commit -m "feat: admin teams management page"
```

---

### Task 8: Update Admin Matches Page

**Files:**
- Modify: `app/admin/matches/page.tsx`

Key changes:
1. Add `sport` field to `mForm` and `Match` type.
2. Replace team_a/team_b text inputs with dropdowns populated from `/api/admin/teams?sport=`.
3. Filter `MARKET_TYPE_OPTIONS` per match sport using `SPORT_MARKETS`.
4. Remove `over_under_line` and `cricheroes_url` from form and Match type.
5. Treat `first_goal_scorer` the same as `top_scorer` in the player picker.

- [ ] **Step 1: Replace `app/admin/matches/page.tsx`**

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { SPORTS, ALL_SPORTS, SPORT_MARKETS, PLAYER_PICKER_MARKETS, SportType } from '@/lib/sports'

type Bet = { id: string; user_id: string; amount: number; status: string; placed_at: string; profiles?: { display_name: string } }
type BetOption = { id: string; label: string; total_amount_bet: number; bets?: Bet[] }
type Market = { id: string; market_type: string; title: string | null; status: string; result: string | null; bet_options: BetOption[] }
type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  venue: string | null
  status: string
  sport: SportType
  markets: Market[]
}
type Team = { id: string; name: string }

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateMatch, setShowCreateMatch] = useState(false)
  const [showCreateMarket, setShowCreateMarket] = useState<string | null>(null)
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set())
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  const [msg, setMsg] = useState('')

  // Team picker state
  const [sportTeams, setSportTeams] = useState<Team[]>([])
  const [teamPlayers, setTeamPlayers] = useState<Record<string, string[]>>({})
  const [checkedPlayers, setCheckedPlayers] = useState<Record<string, boolean>>({})
  const [customCheckedPlayers, setCustomCheckedPlayers] = useState<Record<string, boolean>>({})
  const [customExtraOptions, setCustomExtraOptions] = useState('')

  const [mForm, setMForm] = useState({
    sport: 'cricket' as SportType,
    team_a: '',
    team_b: '',
    match_date: '',
    venue: '',
  })

  const [mkForm, setMkForm] = useState({
    market_type: 'winner',
    options: '',
    house_edge_pct: '5',
    customTitle: '',
  })

  const loadMatches = useCallback(async () => {
    const res = await fetch('/api/admin/matches')
    if (res.ok) setMatches(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadMatches() }, [loadMatches])

  async function fetchSportTeams(sport: SportType) {
    const res = await fetch(`/api/admin/teams?sport=${sport}`)
    if (res.ok) setSportTeams(await res.json())
    else setSportTeams([])
  }

  async function fetchTeamPlayers(teamA: string, teamB: string) {
    const needed = [teamA, teamB].filter(t => t && !teamPlayers[t])
    if (needed.length === 0) return teamPlayers
    const res = await fetch(`/api/admin/players?teams=${needed.join(',')}`)
    if (!res.ok) return teamPlayers
    const data: Record<string, string[]> = await res.json()
    const updated = { ...teamPlayers, ...data }
    setTeamPlayers(updated)
    return updated
  }

  function toggleMarketExpand(marketId: string) {
    setExpandedMarkets(prev => {
      const next = new Set(prev)
      next.has(marketId) ? next.delete(marketId) : next.add(marketId)
      return next
    })
  }

  async function saveMarketTitle(marketId: string) {
    const title = editingTitleValue.trim()
    if (!title) return
    const res = await fetch('/api/admin/markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, title }),
    })
    if (res.ok) { setMsg('Title updated!'); setEditingTitleId(null); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error') }
  }

  async function createMatch(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const res = await fetch('/api/admin/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mForm),
    })
    if (res.ok) {
      setMsg('Match created!')
      setShowCreateMatch(false)
      setMForm({ sport: 'cricket', team_a: '', team_b: '', match_date: '', venue: '' })
      setSportTeams([])
      loadMatches()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error creating match')
    }
  }

  async function openMarketForm(match: Match) {
    if (showCreateMarket === match.id) { setShowCreateMarket(null); return }
    setShowCreateMarket(match.id)
    const players = await fetchTeamPlayers(match.team_a, match.team_b)
    setMkForm({ market_type: 'winner', options: `${match.team_a}\n${match.team_b}`, house_edge_pct: '5', customTitle: '' })
    setCustomExtraOptions('')
    const allPlayers = [...(players[match.team_a] ?? []), ...(players[match.team_b] ?? [])]
    const checked: Record<string, boolean> = {}
    allPlayers.forEach(p => { checked[p] = true })
    setCheckedPlayers(checked)
    const unchecked: Record<string, boolean> = {}
    allPlayers.forEach(p => { unchecked[p] = false })
    setCustomCheckedPlayers(unchecked)
  }

  function handleMarketTypeChange(type: string, match: Match) {
    setMkForm(f => ({ ...f, market_type: type }))
    const playersA = teamPlayers[match.team_a] ?? []
    const playersB = teamPlayers[match.team_b] ?? []
    const allPlayers = [...playersA, ...playersB]

    if (type === 'winner') {
      setMkForm(f => ({ ...f, market_type: type, options: `${match.team_a}\n${match.team_b}` }))
    } else if (PLAYER_PICKER_MARKETS.has(type)) {
      const checked: Record<string, boolean> = {}
      allPlayers.forEach(p => { checked[p] = true })
      setCheckedPlayers(checked)
      setMkForm(f => ({ ...f, market_type: type, options: allPlayers.join('\n') }))
    } else if (type === 'custom') {
      const unchecked: Record<string, boolean> = {}
      allPlayers.forEach(p => { unchecked[p] = false })
      setCustomCheckedPlayers(unchecked)
      setCustomExtraOptions('')
      setMkForm(f => ({ ...f, market_type: type, options: '', customTitle: '' }))
    } else {
      setMkForm(f => ({ ...f, market_type: type, options: '', customTitle: '' }))
    }
  }

  async function createMarket(matchId: string, e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const options = mkForm.market_type === 'custom'
      ? [
          ...Object.entries(customCheckedPlayers).filter(([, v]) => v).map(([k]) => k),
          ...customExtraOptions.split('\n').map(s => s.trim()).filter(Boolean),
        ]
      : mkForm.options.split('\n').map(s => s.trim()).filter(Boolean)

    const res = await fetch('/api/admin/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        market_type: mkForm.market_type,
        title: mkForm.market_type === 'custom' ? mkForm.customTitle.trim() : undefined,
        options,
        house_edge_pct: parseFloat(mkForm.house_edge_pct),
      }),
    })
    if (res.ok) { setMsg('Market created!'); setShowCreateMarket(null); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error creating market') }
  }

  async function toggleMarket(marketId: string, currentStatus: string) {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open'
    await fetch('/api/admin/markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, status: newStatus }),
    })
    loadMatches()
  }

  async function settleMarket(marketId: string, winningOptionId: string) {
    const res = await fetch('/api/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, winning_option_id: winningOptionId }),
    })
    if (res.ok) { setMsg('Market settled! Payouts credited.'); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error settling market') }
  }

  async function deleteMatch(matchId: string, matchName: string) {
    if (!confirm(`Delete "${matchName}"? All pending bets will be refunded.`)) return
    const res = await fetch(`/api/admin/matches?id=${matchId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Match deleted. ${d.refunded} bet(s) refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error deleting match')
  }

  async function deleteMarket(marketId: string, marketType: string) {
    if (!confirm(`Delete this ${marketType} market? All pending bets will be refunded.`)) return
    const res = await fetch(`/api/admin/markets?id=${marketId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Market deleted. ${d.refunded} bet(s) refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error deleting market')
  }

  async function voidBet(betId: string, amount: number) {
    if (!confirm(`Void this ₹${amount} bet and refund the user?`)) return
    const res = await fetch(`/api/admin/bets?id=${betId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Bet voided. ₹${d.refunded} refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error voiding bet')
  }

  if (loading) return <div className="text-[#5a7099] py-10 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Matches &amp; Markets</h1>
        <button
          onClick={() => setShowCreateMatch(!showCreateMatch)}
          className="px-4 py-2 bg-[#F07820] hover:bg-[#D96A18] text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Match
        </button>
      </div>

      {msg && <div className="bg-[#1E2E52] border border-[#243568] rounded-lg px-4 py-2 text-sm text-[#7a91c4]">{msg}</div>}

      {/* Create Match Form */}
      {showCreateMatch && (
        <form onSubmit={createMatch} className="bg-[#162244] border border-[#243568] rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-white">New Match</h2>

          {/* Sport selector */}
          <select
            value={mForm.sport}
            onChange={e => {
              const sport = e.target.value as SportType
              setMForm({ ...mForm, sport, team_a: '', team_b: '' })
              fetchSportTeams(sport)
            }}
            className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
          >
            {ALL_SPORTS.map(s => (
              <option key={s} value={s}>{SPORTS[s].emoji} {SPORTS[s].label}</option>
            ))}
          </select>

          {/* Team dropdowns */}
          <div className="grid grid-cols-2 gap-3">
            <select
              required
              value={mForm.team_a}
              onChange={e => setMForm({ ...mForm, team_a: e.target.value })}
              className="px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
            >
              <option value="">Team A</option>
              {sportTeams.filter(t => t.name !== mForm.team_b).map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
            <select
              required
              value={mForm.team_b}
              onChange={e => setMForm({ ...mForm, team_b: e.target.value })}
              className="px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
            >
              <option value="">Team B</option>
              {sportTeams.filter(t => t.name !== mForm.team_a).map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {sportTeams.length === 0 && (
            <p className="text-xs text-[#C41E28]">
              No {SPORTS[mForm.sport].label} teams registered yet.{' '}
              <a href="/admin/teams" className="underline text-[#F07820]">Add teams first →</a>
            </p>
          )}

          <input
            required
            type="datetime-local"
            value={mForm.match_date}
            onChange={e => setMForm({ ...mForm, match_date: e.target.value })}
            className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
          />
          <input
            placeholder="Venue (optional)"
            value={mForm.venue}
            onChange={e => setMForm({ ...mForm, venue: e.target.value })}
            className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-[#F07820] hover:bg-[#D96A18] text-white rounded-lg text-sm font-medium">Create</button>
            <button type="button" onClick={() => setShowCreateMatch(false)} className="px-4 py-2 bg-[#1E2E52] text-[#7a91c4] rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Matches List */}
      <div className="space-y-4">
        {matches.map((match) => {
          const sportMarkets = SPORT_MARKETS[match.sport] ?? SPORT_MARKETS.cricket
          return (
            <div key={match.id} className="bg-[#162244] border border-[#243568] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#7a91c4] mb-0.5">{SPORTS[match.sport]?.emoji} {SPORTS[match.sport]?.label}</p>
                  <h2 className="font-bold text-white">{match.team_a} vs {match.team_b}</h2>
                  <p className="text-xs text-[#5a7099]">
                    {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')} · {match.venue ?? 'TBD'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    match.status === 'live' ? 'bg-[#C41E28] text-white' :
                    match.status === 'upcoming' ? 'bg-[#1B3A8A] text-white' :
                    'bg-[#243568] text-[#7a91c4]'
                  }`}>{match.status}</span>
                  <button onClick={() => openMarketForm(match)} className="px-3 py-1 bg-[#1E2E52] hover:bg-[#243568] text-[#7a91c4] rounded text-xs">
                    + Market
                  </button>
                  <button onClick={() => deleteMatch(match.id, `${match.team_a} vs ${match.team_b}`)} className="px-3 py-1 bg-[#C41E28]/10 hover:bg-[#C41E28]/20 text-[#C41E28] rounded text-xs">
                    🗑 Delete
                  </button>
                </div>
              </div>

              {/* Create Market Form */}
              {showCreateMarket === match.id && (
                <form onSubmit={(e) => createMarket(match.id, e)} className="bg-[#0D1730] border border-[#243568] rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-white">New Market</h3>

                  <select
                    value={mkForm.market_type}
                    onChange={e => handleMarketTypeChange(e.target.value, match)}
                    className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm"
                  >
                    {sportMarkets.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {/* Player picker for top_scorer / first_goal_scorer */}
                  {PLAYER_PICKER_MARKETS.has(mkForm.market_type) ? (
                    <div className="space-y-2">
                      {[match.team_a, match.team_b].map(teamName => {
                        const players = teamPlayers[teamName] ?? []
                        return (
                          <div key={teamName}>
                            <p className="text-xs font-semibold text-[#F07820] mb-1">{teamName}</p>
                            <div className="grid grid-cols-2 gap-1">
                              {players.length === 0 && <p className="text-xs text-[#5a7099] col-span-2">No players registered</p>}
                              {players.map(player => (
                                <label key={player} className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-[#1E2E52] rounded hover:bg-[#243568]">
                                  <input
                                    type="checkbox"
                                    checked={checkedPlayers[player] ?? true}
                                    onChange={e => {
                                      const updated = { ...checkedPlayers, [player]: e.target.checked }
                                      setCheckedPlayers(updated)
                                      const allPlayers = [
                                        ...(teamPlayers[match.team_a] ?? []),
                                        ...(teamPlayers[match.team_b] ?? []),
                                      ]
                                      setMkForm(f => ({ ...f, options: allPlayers.filter(p => updated[p] ?? true).join('\n') }))
                                    }}
                                    className="accent-[#F07820]"
                                  />
                                  <span className="text-xs text-white">{player}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : mkForm.market_type === 'winner' ? (
                    <div className="flex gap-2">
                      {[match.team_a, match.team_b].map(t => (
                        <div key={t} className="flex-1 px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm text-center font-medium">{t}</div>
                      ))}
                    </div>
                  ) : mkForm.market_type === 'custom' ? (
                    <div className="space-y-3">
                      <input
                        required
                        placeholder="Market title (e.g. Top Points Scorer)"
                        value={mkForm.customTitle}
                        onChange={e => setMkForm({ ...mkForm, customTitle: e.target.value })}
                        className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F07820]"
                      />
                      {[match.team_a, match.team_b].map(teamName => {
                        const players = teamPlayers[teamName] ?? []
                        return (
                          <div key={teamName}>
                            <p className="text-xs font-semibold text-[#F07820] mb-1">{teamName}</p>
                            <div className="grid grid-cols-2 gap-1">
                              {players.map(player => (
                                <label key={player} className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-[#1E2E52] rounded hover:bg-[#243568]">
                                  <input
                                    type="checkbox"
                                    checked={customCheckedPlayers[player] ?? false}
                                    onChange={e => setCustomCheckedPlayers(prev => ({ ...prev, [player]: e.target.checked }))}
                                    className="accent-[#F07820]"
                                  />
                                  <span className="text-xs text-white">{player}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      <textarea
                        placeholder={`Additional options (one per line)`}
                        value={customExtraOptions}
                        onChange={e => setCustomExtraOptions(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm font-mono"
                      />
                    </div>
                  ) : (
                    <textarea
                      required
                      placeholder={`Bet options (one per line)\ne.g.\nOver 5.5\nUnder 5.5`}
                      value={mkForm.options}
                      onChange={e => setMkForm({ ...mkForm, options: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm font-mono"
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#7a91c4]">House edge %</label>
                    <input
                      type="number" value={mkForm.house_edge_pct} min="0" max="20"
                      onChange={e => setMkForm({ ...mkForm, house_edge_pct: e.target.value })}
                      className="w-20 px-2 py-1 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="px-3 py-1.5 bg-[#F07820] hover:bg-[#D96A18] text-white rounded text-sm">Create</button>
                    <button type="button" onClick={() => setShowCreateMarket(null)} className="px-3 py-1.5 bg-[#1E2E52] text-[#7a91c4] rounded text-sm">Cancel</button>
                  </div>
                </form>
              )}

              {/* Markets */}
              {match.markets?.length > 0 && (
                <div className="space-y-3">
                  {match.markets.map(market => (
                    <div key={market.id} className="bg-[#0D1730] border border-[#243568] rounded-lg p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer select-none"
                        onClick={() => toggleMarketExpand(market.id)}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[#5a7099] text-xs">{expandedMarkets.has(market.id) ? '▾' : '▸'}</span>
                          {editingTitleId === market.id ? (
                            <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={editingTitleValue}
                                onChange={e => setEditingTitleValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveMarketTitle(market.id); if (e.key === 'Escape') setEditingTitleId(null) }}
                                className="flex-1 px-2 py-0.5 bg-[#1E2E52] border border-[#243568] rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#F07820]"
                              />
                              <button onClick={() => saveMarketTitle(market.id)} className="text-xs px-2 py-0.5 bg-[#F07820] hover:bg-[#D96A18] text-white rounded">Save</button>
                              <button onClick={() => setEditingTitleId(null)} className="text-xs px-2 py-0.5 bg-[#1E2E52] text-[#7a91c4] rounded">✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-medium text-white capitalize">
                                {market.title || market.market_type.replace(/_/g, ' ')}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); setEditingTitleId(market.id); setEditingTitleValue(market.title || '') }}
                                className="text-[#5a7099] hover:text-[#7a91c4] text-xs"
                              >✎</button>
                              <span className="text-xs text-[#5a7099]">
                                {market.bet_options?.length ?? 0} options · ₹{(market.bet_options ?? []).reduce((s, o) => s + Number(o.total_amount_bet), 0).toLocaleString('en-IN')} staked
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          {market.status !== 'settled' && (
                            <button
                              onClick={() => toggleMarket(market.id, market.status)}
                              className={`px-3 py-1 rounded text-xs font-medium ${
                                market.status === 'open'
                                  ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                                  : 'bg-[#F07820]/20 text-[#F07820] hover:bg-[#F07820]/30'
                              }`}
                            >
                              {market.status === 'open' ? 'Close Betting' : 'Open Betting'}
                            </button>
                          )}
                          {market.status === 'settled' && (
                            <span className="text-xs text-[#5a7099]">Settled: {market.result}</span>
                          )}
                          {market.status !== 'settled' && (
                            <button
                              onClick={() => deleteMarket(market.id, market.market_type.replace(/_/g, ' '))}
                              className="px-2 py-1 bg-[#C41E28]/10 hover:bg-[#C41E28]/20 text-[#C41E28] rounded text-xs"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </div>

                      {expandedMarkets.has(market.id) && (
                        <div className="space-y-2 mt-3">
                          {market.bet_options?.map(opt => (
                            <div key={opt.id} className="bg-[#162244] border border-[#243568] rounded p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p className="text-xs font-medium text-white">{opt.label}</p>
                                  <p className="text-xs text-[#5a7099]">₹{Number(opt.total_amount_bet).toLocaleString()} total</p>
                                </div>
                                {(market.status === 'closed' || market.status === 'open') && (
                                  <button
                                    onClick={() => { if (confirm(`Declare "${opt.label}" as winner?`)) settleMarket(market.id, opt.id) }}
                                    className="text-xs px-2 py-1 bg-[#F07820] hover:bg-[#D96A18] text-white rounded"
                                  >
                                    ✓ Winner
                                  </button>
                                )}
                              </div>
                              {opt.bets && opt.bets.filter(b => b.status !== 'void').length > 0 && (
                                <div className="space-y-1 mt-1 border-t border-[#243568] pt-1">
                                  {opt.bets.filter(b => b.status !== 'void').map(bet => (
                                    <div key={bet.id} className="flex items-center justify-between text-xs">
                                      <span className="text-[#7a91c4]">
                                        {bet.profiles?.display_name ?? bet.user_id.slice(0, 8)} — ₹{Number(bet.amount).toLocaleString()}
                                        <span className={`ml-1 ${bet.status === 'won' ? 'text-[#F07820]' : bet.status === 'lost' ? 'text-[#C41E28]' : 'text-yellow-400'}`}>
                                          ({bet.status})
                                        </span>
                                      </span>
                                      {bet.status === 'pending' && (
                                        <button
                                          onClick={() => voidBet(bet.id, Number(bet.amount))}
                                          className="px-1.5 py-0.5 bg-[#C41E28]/10 hover:bg-[#C41E28]/20 text-[#C41E28] rounded ml-2"
                                        >
                                          Void
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {matches.length === 0 && (
          <p className="text-[#5a7099] text-center py-10">No matches yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/matches/page.tsx
git commit -m "feat: admin matches — sport selector, team dropdowns, sport-filtered market types"
```

---

### Task 9: Update Admin Panel Page

**Files:**
- Modify: `app/admin/page.tsx`

Add a "Teams" card to the navigation grid.

- [ ] **Step 1: Add Teams link to the nav grid in `app/admin/page.tsx`**

Find the `<div className="grid gap-4 sm:grid-cols-3">` section and add a fourth link:

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <Link href="/admin/matches" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
    <h2 className="text-lg font-semibold mb-1">Matches &amp; Markets</h2>
    <p className="text-[#7a91c4] text-sm">Create matches, open/close betting markets, declare results</p>
  </Link>
  <Link href="/admin/teams" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
    <h2 className="text-lg font-semibold mb-1">⚽ Teams</h2>
    <p className="text-[#7a91c4] text-sm">Register teams per sport before creating matches</p>
  </Link>
  <Link href="/admin/users" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
    <h2 className="text-lg font-semibold mb-1">User Wallets</h2>
    <p className="text-[#7a91c4] text-sm">Top up user balances after cash collection</p>
  </Link>
  <Link href="/admin/ledger" className="block bg-[#162244] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-colors">
    <h2 className="text-lg font-semibold mb-1">📒 Ledger</h2>
    <p className="text-[#7a91c4] text-sm">View all bets by all users, per-user P&amp;L summary</p>
  </Link>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: admin panel — add Teams nav card"
```

---

### Task 10: Homepage → Sports Hub

**Files:**
- Modify: `app/page.tsx`

Replace the match list with 6 sport cards. Each shows the sport emoji, label, live/upcoming counts, and links to `/sports/[sport]`.

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SPORTS, ALL_SPORTS, SportType } from '@/lib/sports'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = createServerSupabaseClient()
  const { data: matches } = await supabase
    .from('matches')
    .select('sport, status')
    .in('status', ['live', 'upcoming'])

  const counts: Record<SportType, { live: number; upcoming: number }> = {
    cricket: { live: 0, upcoming: 0 },
    football: { live: 0, upcoming: 0 },
    table_tennis: { live: 0, upcoming: 0 },
    volleyball: { live: 0, upcoming: 0 },
    pool: { live: 0, upcoming: 0 },
    basketball: { live: 0, upcoming: 0 },
  }

  ;(matches ?? []).forEach((m: { sport: SportType; status: string }) => {
    if (counts[m.sport]) {
      if (m.status === 'live') counts[m.sport].live++
      else counts[m.sport].upcoming++
    }
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">BCL Tournament</h1>
        <p className="text-[#7a91c4] text-sm mt-1">Select a sport to view matches and place bets</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_SPORTS.map(sport => {
          const { live, upcoming } = counts[sport]
          return (
            <Link key={sport} href={`/sports/${sport}`}>
              <div className="bg-[#162244] hover:bg-[#1E2E52] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-6 transition-all cursor-pointer h-full">
                <div className="text-4xl mb-3">{SPORTS[sport].emoji}</div>
                <h2 className="text-lg font-bold text-white">{SPORTS[sport].label}</h2>
                <div className="mt-2 space-y-0.5 min-h-[36px]">
                  {live > 0 && (
                    <p className="text-xs text-[#C41E28] font-medium animate-pulse">
                      🔴 {live} match{live > 1 ? 'es' : ''} live now
                    </p>
                  )}
                  {upcoming > 0 && (
                    <p className="text-xs text-[#7a91c4]">{upcoming} upcoming</p>
                  )}
                  {live === 0 && upcoming === 0 && (
                    <p className="text-xs text-[#5a7099]">No matches scheduled</p>
                  )}
                </div>
                <p className="text-xs text-[#F07820] font-medium mt-4">View matches →</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: homepage → sports hub with 6 sport cards"
```

---

### Task 11: Sport Landing Page + Match Detail

**Files:**
- Create: `app/sports/[sport]/page.tsx`
- Create: `app/sports/[sport]/[matchId]/page.tsx`

- [ ] **Step 1: Create `app/sports/[sport]/page.tsx`**

```tsx
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import { notFound } from 'next/navigation'
import { SPORTS, SportType } from '@/lib/sports'
import AdBanner from '@/components/ui/AdBanner'

export const dynamic = 'force-dynamic'

type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  venue: string | null
  status: string
  sport: SportType
  markets: { id: string; market_type: string; status: string }[]
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    live:      'bg-[#C41E28] animate-pulse',
    upcoming:  'bg-[#1B3A8A]',
    completed: 'bg-[#243568] text-[#7a91c4]',
    cancelled: 'bg-yellow-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${colors[status] ?? 'bg-[#243568]'}`}>
      {status.toUpperCase()}
    </span>
  )
}

function MatchCard({ match }: { match: Match }) {
  const openMarkets = match.markets?.filter(m => m.status === 'open').length ?? 0
  return (
    <Link href={`/sports/${match.sport}/${match.id}`}>
      <div className="bg-[#162244] hover:bg-[#1E2E52] border border-[#243568] hover:border-[#F07820]/50 rounded-xl p-5 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <StatusBadge status={match.status} />
          <span className="text-xs text-[#5a7099]">
            {format(new Date(match.match_date), 'dd MMM, h:mm a')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_a}</p>
          </div>
          <div className="text-[#5a7099] font-bold text-sm px-4">VS</div>
          <div className="text-center flex-1">
            <p className="font-bold text-lg">{match.team_b}</p>
          </div>
        </div>
        {match.venue && (
          <p className="text-xs text-[#5a7099] text-center mt-2">{match.venue}</p>
        )}
        <div className="mt-3 pt-3 border-t border-[#243568] flex items-center justify-between">
          <span className="text-xs text-[#7a91c4]">
            {openMarkets > 0
              ? <span className="text-[#F07820]">{openMarkets} market{openMarkets > 1 ? 's' : ''} open</span>
              : 'No open markets'}
          </span>
          <span className="text-xs text-[#F07820] font-medium">View →</span>
        </div>
      </div>
    </Link>
  )
}

export default async function SportPage({ params }: { params: { sport: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()

  const supabase = createServerSupabaseClient()
  const { data: matches } = await supabase
    .from('matches')
    .select('*, markets(id, market_type, status)')
    .eq('sport', sport)
    .order('match_date', { ascending: true })

  const now = new Date()
  const live      = (matches ?? []).filter((m: Match) => m.status === 'live')
  const upcoming  = (matches ?? []).filter((m: Match) => m.status === 'upcoming' && new Date(m.match_date) > now)
  const completed = (matches ?? [])
    .filter((m: Match) => m.status === 'completed' || (m.status === 'upcoming' && new Date(m.match_date) <= now))
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-[#7a91c4] hover:text-white text-sm transition-colors">← Sports</Link>
        <span className="text-[#243568]">/</span>
        <h1 className="text-2xl font-bold text-white">
          {SPORTS[sport].emoji} {SPORTS[sport].label}
        </h1>
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#C41E28] mb-3">Live Now</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {live.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      <AdBanner />

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#F07820] mb-3">Upcoming</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      <AdBanner />

      {completed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#5a7099] mb-3">Completed</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {completed.map((m: Match) => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {(matches ?? []).length === 0 && (
        <div className="text-center py-20 text-[#5a7099]">
          <p className="text-4xl mb-3">{SPORTS[sport].emoji}</p>
          <p>No {SPORTS[sport].label} matches scheduled yet.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/sports/[sport]/[matchId]/page.tsx`**

```tsx
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import Link from 'next/link'
import MarketsSection from '@/components/betting/MarketsSection'
import { SPORTS, SportType } from '@/lib/sports'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: { sport: string; matchId: string } }) {
  const sport = params.sport as SportType
  if (!SPORTS[sport]) notFound()

  const supabase = createServerSupabaseClient()
  const [{ data: match }, { data: { user } }] = await Promise.all([
    supabase
      .from('matches')
      .select('*, markets(*, bet_options(*))')
      .eq('id', params.matchId)
      .eq('sport', sport)
      .single(),
    supabase.auth.getUser(),
  ])

  if (!match) notFound()

  let userBalance: number | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single()
    userBalance = profile?.wallet_balance ?? null
  }

  return (
    <div className="space-y-6">
      <Link href={`/sports/${sport}`} className="text-sm text-[#7a91c4] hover:text-white transition-colors">
        ← {SPORTS[sport].emoji} {SPORTS[sport].label}
      </Link>

      <div className="bg-[#162244] border border-[#243568] rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            match.status === 'live'      ? 'bg-[#C41E28] text-white animate-pulse' :
            match.status === 'upcoming'  ? 'bg-[#1B3A8A] text-white' :
                                           'bg-[#243568] text-[#7a91c4]'
          }`}>
            {match.status.toUpperCase()}
          </span>
          <span className="text-xs text-[#5a7099]">
            {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')}
          </span>
        </div>

        <div className="flex items-center justify-around mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_a}</p>
          </div>
          <div className="text-[#5a7099] font-bold">VS</div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{match.team_b}</p>
          </div>
        </div>

        {match.venue && (
          <p className="text-center text-[#5a7099] text-sm mt-3">{match.venue}</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Betting Markets</h2>

        {!user && (
          <div className="bg-[#F07820]/10 border border-[#F07820]/30 rounded-lg p-4 mb-4 text-sm text-[#F07820]">
            <a href="/login" className="underline">Sign in</a> to place bets.
          </div>
        )}

        {user && userBalance !== null && (
          <div className="bg-[#162244] border border-[#243568] rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <span className="text-sm text-[#7a91c4]">Your balance</span>
            <span className="font-bold text-[#F07820]">₹{userBalance.toLocaleString()}</span>
          </div>
        )}

        <MarketsSection
          initialMarkets={match.markets ?? []}
          matchId={match.id}
          userBalance={userBalance}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/sports/[sport]/page.tsx" "app/sports/[sport]/[matchId]/page.tsx"
git commit -m "feat: sport landing pages and match detail at /sports/[sport]/[matchId]"
```

---

### Task 12: Navbar Update

**Files:**
- Modify: `components/ui/Navbar.tsx`

Replace the "Matches" and "Teams" links with a single "Sports" link (points to `/`, the sports hub). Remove the public Teams link.

- [ ] **Step 1: Update `components/ui/Navbar.tsx`**

Replace these two lines:

```tsx
{navLink('/', 'Matches')}
{navLink('/teams', 'Teams')}
```

With a single line:

```tsx
{navLink('/', 'Sports')}
```

The `navLink` helper's active check (`pathname === href`) will highlight "Sports" when on the homepage. For sport subpages, it won't be highlighted — which is acceptable for a compact nav.

- [ ] **Step 2: Commit and push**

```bash
git add components/ui/Navbar.tsx
git commit -m "feat: navbar — rename Matches to Sports, remove public Teams link"
git push origin main
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `sport_type` enum (6 sports) | Task 1 |
| `teams` table with RLS | Task 1 |
| Add `sport` column to matches | Task 1 |
| Drop CricHeroes + live score columns | Task 1 |
| New market_type enum values | Task 1 |
| `reset_season()` RPC | Task 1 |
| `lib/sports.ts` constants | Task 2 |
| Teams API (GET, POST, DELETE) | Task 3 |
| Season Reset API | Task 4 |
| FinancialOverview season reset button | Task 4 |
| Remove CricHeroes files + cron | Task 5 |
| Matches API updated (sport, no CricHeroes) | Task 6 |
| Admin teams page | Task 7 |
| Admin matches page (sport selector, team dropdowns, sport-filtered markets) | Task 8 |
| Admin panel links updated | Task 9 |
| Homepage → sports hub | Task 10 |
| `/sports/[sport]` landing page | Task 11 |
| `/sports/[sport]/[matchId]` match detail (no live scores) | Task 11 |
| Navbar update | Task 12 |

All spec requirements are covered.

**Type consistency:**
- `SportType` defined in Task 2, used consistently in Tasks 3, 4, 7, 8, 10, 11, 12.
- `PLAYER_PICKER_MARKETS` defined in Task 2, used in Task 8.
- Match detail params: `{ sport: string; matchId: string }` consistent across Task 11.
- API paths: `/api/admin/teams`, `/api/admin/teams/[id]`, `/api/admin/reset-season` consistent across Tasks 3, 4, 7.

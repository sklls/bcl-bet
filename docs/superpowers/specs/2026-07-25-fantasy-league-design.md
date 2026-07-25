# Fantasy League + Pari-mutuel Rework — Design

**Date:** 2026-07-25
**Status:** Awaiting review

## Context

PrimeStake is a private multi-sport betting platform for the BCL, a closed college
league across six sports. This design adds a Dream11-style fantasy league for
cricket and football, and reworks the betting odds engine to true pari-mutuel.

Both changes share one engine: **money goes into a pot, the house takes 5%, the
remainder is split among winners.** Betting splits by *who was right*; fantasy
splits by *rank*.

## Scope

| Sport | Betting | Fantasy |
|---|---|---|
| Cricket | ✅ | ✅ |
| Football | ✅ | ✅ |
| Basketball, Volleyball, Table Tennis, Pool | ✅ | ❌ |

Fantasy is limited to cricket and football because they are the only sports with
enough per-player events to differentiate lineups, and because every additional
sport multiplies the manual stat-entry burden.

## Navigation

```
/sports/cricket   ─┐
                   ├─→  mode chooser  ─┬─→  /sports/<sport>/fantasy
/sports/football  ─┘                   └─→  /sports/<sport>/betting

/sports/basketball ─→  betting directly   (no chooser)
/sports/volleyball ─→  betting directly
/sports/table_tennis ─→ betting directly
/sports/pool       ─→  betting directly
```

Cricket and football land on a two-card chooser. The other four bypass it and go
straight to the existing sport landing page.

---

# Part A — Pari-mutuel betting

## The problem being fixed

The current engine computes pari-mutuel odds (`lib/odds.ts:11`) but *locks them in*
at placement (`bets.odds_at_placement`) and pays `amount × odds_at_placement` at
settlement. That is a fixed-odds payout funded by a pool, and the two do not
reconcile.

An audit of all 43 settled markets (₹155,117 turnover) found:

- **No market ever paid out more than it collected** — the theoretical house loss
  never materialised, because markets were small (4.2 bets each).
- **The house took 10.83%, not the intended 5%.** ₹16,802 on ₹155,117.
- **8 markets kept ₹9,522 entirely** because nobody backed the winner — 6.1% of
  turnover, which accounts for almost all the overtake.
- **34% of bets (60 of 179) locked odds of 1.00–1.05x**, the `Math.max(1.01, …)`
  floor. Real money staked for a 1% return.
- **A live extraction exploit.** Staking ₹1 on an untouched option in a large pool
  locks in odds worth ~95% of the whole pool. It has been used at least 6 times —
  ₹1 at 5700.95x, ₹1 at 1140.95x, ₹1 at 1045.95x — for roughly ₹11,200 returned on
  ₹14 staked. Mostly the admin account, but one regular user found it independently.

Locked odds are the root cause of all four.

## The model

No odds are stored at placement. Only the stake.

```
payout_pool  = total_pool × (1 − house_edge)
your_payout  = payout_pool × (your_stake / total_staked_on_winning_option)
```

Everyone on the winning side receives the same effective price, so a ₹1 stake
collects ₹1's worth of the pot. The exploit closes by construction.

**Display:** live projected odds, `(pool × 0.95) / staked_on_option`, recomputed
from realtime `bet_options` updates. The bet slip shows *"~₹950 at current pool"*,
never *"Win ₹950"*.

## House seeding

Pari-mutuel's cost is that late money reprices everyone. Measured on real data,
the single largest bet averages **50% of the entire pool** — with 17 users and
~5 bets per market, one person routinely moves everyone's payout. A percentage
stake cap was rejected: capping at 10% of pool would block 53% of all bets, and
even 33% would block 25%. The pools are too small for caps to catch only whales.

Instead **the house seeds each market**, and critically the seed is
**split equally across the options**, not left unallocated.

```
per_option_seed = market.seed_amount / count(bet_options)
```

The seed counts as stake for both odds and settlement. Because it sits *on* the
outcomes, the house's share of its own seed on the winning option is simply never
paid out — so the seed largely returns to the house rather than being a pure
subsidy.

### Why split rather than unallocated

Simulated over the 30 real settled markets:

| Seed | Mode | Shown-vs-actual gap | House / season |
|---|---|---|---|
| ₹0 | — | wildly wrong both ways | +₹6,930 |
| ₹500 | unallocated | ok | **−₹22,320** |
| ₹500 | split on options | within 5% | +₹16,237 |
| **₹1,000** | **split on options** | **within 3%** | **+₹9,776** |
| ₹2,000 | split on options | within 7% | −₹4,300 |

Unallocated seeding costs ₹22,320 a season because the house funds a larger pot
and claims none of it. Split across options at ₹1,000, projections land within 3%
of the final payout and the house still clears ~₹9,800.

**The main benefit is not skew-dampening — it is that the displayed number becomes
meaningful at all.** Un-seeded, the first bettor into a market sees 0.95x or
1140.95x purely depending on which side they picked first, then lands somewhere
unrelated. Seeding gives every option a non-zero base so opening prices are sane.

**Default: ₹1,000 per market**, stored on `markets.seed_amount` and editable per
market by the admin. ₹500 is the conservative alternative — it preserves last
season's ₹16,801 margin almost exactly.

**Known limit:** seeding barely improves the *worst* case, which only falls from a
100% to an 83% gap. A late ₹5,000 bet still dilutes badly whatever the pot started
at. The live pool-composition display has to carry that, by making the shift
visible while it happens rather than a surprise at settlement.

## Settlement rules

| Case | Behaviour |
|---|---|
| Normal | Pro-rata split of `pool × 0.95` among winners |
| **Nobody backed the winner** | **Void, refund every stake.** Seed returns to the house |
| **Only one option received real bets** | **Void, refund.** No contest took place |
| **Pro-rata would return less than stake** | **Guarantee the stake.** House take shrinks to whatever remains |

Note the second rule tests *real bets*, not stake: once seeded, every option always
holds money, so the un-seeded test would never fire.

Settlement totals include the seed on both sides of the ratio:

```
W            = staked_on_winner + seed_on_winner
payout_pool  = (total_pool + total_seed) × 0.95
your_payout  = payout_pool × (your_stake / W)
```

The house's implicit claim, `payout_pool × (seed_on_winner / W)`, is simply never
disbursed — it stays in the house account and needs no ledger entry.

The last rule removes the "I won my bet and lost money" outcome that the 1.01x
floor produced 60 times.

### No minimum stake

An earlier draft specified a ₹10 minimum to stop ₹1 lottery-ticket spam. **Dropped
— it fixes a problem that pari-mutuel already closes.** ₹1 bets were only
dangerous because locked odds turned them into free options on the pool. Pro-rata
makes the same bet unremarkable: ₹1 into a ₹12,000 pool with ₹5,100 on the winner
pays ₹2.24.

The data does not support a floor either. Stakes of ₹10 or less are 11.2% of bets
but **₹137 of ₹155,117 turnover (0.09%)**, and 17 of those 20 bets are the admin
account probing the exploit. Median stake is ₹500, p25 is ₹200.

Against that, a floor excludes players with low balances at exactly the moment
they are most price-sensitive, and works against the engagement goal in
`PRODUCT.md:19`.

Raise the existing `CHECK (amount > 0)` to `>= 1` so sub-rupee stakes are
impossible (`bets.amount` is `DECIMAL(10,2)`, so ₹0.01 is currently legal). If ₹1
spam ever becomes a nuisance, rate-limit bets per user per market — that targets
the behaviour rather than penalising cautious players.

## Migration path

- `odds_at_placement` becomes nullable and display-only; retained for history.
- `place_bet` RPC drops its `p_odds` argument.
- `settle_market` is replaced by a pro-rata implementation.
- The one currently-open market settles under the old logic; the model switches
  cleanly at the season boundary.

---

# Part B — Fantasy league

## Player pricing

Admin assigns each cricket and football player a **rating of 1–10**. Price is linear:

```
credits = 6 + (rating × 0.5)      →   rating 1 = 6.5,  rating 10 = 11.0
```

**Budget: 100 credits for 11 players.**

The affordable average is 100 ÷ 11 = 9.09, which sits ~58% of the way up the
6.5–11.0 range — the same balance point Dream11 uses. That ratio is what makes
the budget bite:

- 11 × rating-10 = 121 credits → unaffordable, as intended
- 11 × rating-1 = 71.5 credits → comfortably affordable

Verified against all 9 seeded fixtures: the most expensive legal XI costs 106–110
credits and the cheapest 74–80, so every fixture forces a genuine choice. A greedy
best-XI pick on Titans v Daredevils lands at exactly 100.0 credits with ratings
`9, 9, 9, 8, 8, 8, 8, 6, 1, 1, 1` — three stars, four solid players, three minimum
-price fillers.

**An earlier curve of `5 + rating × 0.5` was rejected**: it put 9.09 at 80% of the
range, and measurement showed the priciest XI cost only 95–99 in every fixture,
so the budget never constrained anything.

### Seeding ratings

Ratings seed from **percentile rank of the auction `bid_amount` within each sport**:

```sql
rating = 1 + floor(9 × percent_rank() over (partition by sport order by bid_amount))
```

Rank rather than absolute bid, because real bids cluster low — most BCL players
went for 2–9 as Novices. Mapping bids directly gave cricket an average rating of
4.9 and flattened the price spread. Percentile ranking guarantees a full 1–10
distribution whatever the bid distribution looks like.

These are starting values only; the admin curates from there.

## Lineup rules

- **11 players** drawn from the two squads in that match
- **Max 7 from one team**
- **Captain 2×**, **Vice-captain 1.5×**
- **Locks at match start.** No edits afterwards
- One entry per user per contest

Cricket deliberately has **no positional quotas** (Dream11's 1–4 WK / 3–6 BAT /
1–4 AR / 3–6 BOWL), because the existing roles are auction tiers — Captain,
Marquee, Intermediate, Novice — not playing roles. Adding quotas would require
classifying all 139 players by hand. Football *does* get quotas (min 1 GK, 3 DEF,
3 MID, 1 FWD) since positions are seeded and obvious.

**Known risk:** without cricket quotas, lineups may skew to batsmen. Wickets at 25
points should counteract this. This is the first number to tune after week one.

## Scoring

Five stats per sport, chosen so one scorer with a phone can capture them live.

### Cricket

| Stat | Points |
|---|---|
| Played | 2 |
| Run scored | 1 each |
| Wicket | 25 each |
| Catch | 8 each |
| Six | 2 each (bonus) |
| Run-out / stumping | 12 each |

### Football

| Stat | Points |
|---|---|
| Played | 2 |
| Goal | 10 each |
| Assist | 6 each |
| Save | 3 each |
| Clean sheet (GK/DEF only) | 6 |
| Yellow card | −2 |
| Red card | −6 |

Deliberately excluded: strike rate, economy, minutes played. Each needs a second
input field (balls faced, overs bowled, minutes) to compute, roughly doubling data
entry for modest gain. Revisit in v2 if stat entry proves reliable.

## Contests and prizes

One contest per match. Entry costs wallet money; fees pool exactly like a betting
market.

```
prize_pool = (entry_fee × entrants) × 0.95
```

| Entrants | Places paid | Split |
|---|---|---|
| 10+ | Top 5 | 40 / 25 / 15 / 12 / 8 % |
| 4–9 | Top 3 | 50 / 30 / 20 % |
| Under 4 | — | Void, refund entries |

**Ties** split the combined prize for the places they occupy. Two tied for 2nd
share 2nd + 3rd money; the next player is 4th.

Default entry fee ₹100, set per contest by the admin.

## Admin stat entry

The operational make-or-break. One screen per match:

- Both squads listed, home team first
- Per player: a **played** toggle, then 5 numeric steppers
- Large tap targets, no keyboard needed for common values
- **Save draft** at any point; **Publish** triggers scoring and settlement
- Publishing is idempotent — re-publishing recomputes points and payouts

Scoring runs server-side from `player_match_stats`; points are never trusted from
the client.

## Schema

```sql
-- fantasy contests, one per match
CREATE TABLE contests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id       UUID REFERENCES matches(id) ON DELETE CASCADE,
  entry_fee      NUMERIC(10,2) NOT NULL DEFAULT 100,
  house_edge_pct NUMERIC(4,2)  NOT NULL DEFAULT 5.0,
  status         contest_status NOT NULL DEFAULT 'open',  -- open|locked|settled|void
  prize_pool     NUMERIC(12,2) DEFAULT 0,
  locks_at       TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id)
);

CREATE TABLE contest_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contest_id      UUID REFERENCES contests(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  captain_id      UUID REFERENCES team_players(id),
  vice_captain_id UUID REFERENCES team_players(id),
  total_points    NUMERIC(8,2),
  rank            INT,
  payout          NUMERIC(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contest_id, user_id)
);

CREATE TABLE entry_players (
  entry_id  UUID REFERENCES contest_entries(id) ON DELETE CASCADE,
  player_id UUID REFERENCES team_players(id),
  PRIMARY KEY (entry_id, player_id)
);

CREATE TABLE player_match_stats (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID REFERENCES matches(id) ON DELETE CASCADE,
  player_id   UUID REFERENCES team_players(id),
  played      BOOLEAN NOT NULL DEFAULT false,
  -- cricket
  runs        INT DEFAULT 0,
  wickets     INT DEFAULT 0,
  catches     INT DEFAULT 0,
  sixes       INT DEFAULT 0,
  run_outs    INT DEFAULT 0,
  -- football
  goals       INT DEFAULT 0,
  assists     INT DEFAULT 0,
  saves       INT DEFAULT 0,
  clean_sheet BOOLEAN DEFAULT false,
  yellows     INT DEFAULT 0,
  reds        INT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);
```

Two new `transaction_type` values — `fantasy_entry` and `fantasy_prize` — so the
existing ledger, leaderboard and P&L stay honest across both modes on one wallet.

Betting-side columns for house seeding:

```sql
ALTER TABLE markets
  ADD COLUMN seed_amount NUMERIC(10,2) NOT NULL DEFAULT 1000;

-- per-option allocation, set at market creation to seed_amount / option_count.
-- kept separate from total_amount_bet so house money stays distinguishable
-- from real stakes for accounting and for the bettors list.
ALTER TABLE bet_options
  ADD COLUMN seed_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- sub-rupee stakes are currently legal; raise the floor to ₹1
ALTER TABLE bets
  DROP CONSTRAINT bets_amount_check,
  ADD CONSTRAINT bets_amount_check CHECK (amount >= 1);
```

## Components

| Unit | Responsibility |
|---|---|
| `lib/parimutuel.ts` | Projected odds + pro-rata settlement maths. Pure functions |
| `lib/fantasy/scoring.ts` | Stats → points per sport. Pure, table-driven |
| `lib/fantasy/lineup.ts` | Lineup validation: budget, count, max-per-team, quotas |
| `settle_contest()` RPC | Rank, distribute, credit wallets, log transactions — atomic |
| `settle_market()` RPC | Pro-rata betting settlement — atomic |
| Admin stat entry screen | Capture 5 stats per player, draft + publish |
| Fantasy team builder | Squad list, credit meter, C/VC pickers |

Scoring and lineup validation are pure and table-driven so points rules can be
tuned without touching persistence.

## Testing

- Pure-function unit tests for scoring, lineup validation and pari-mutuel maths,
  including every settlement edge case (no winner, single option, stake guarantee)
- A replay test asserting the ₹1 exploit yields a proportional payout under the new
  engine
- RPC tests for atomicity: contest settlement must be all-or-nothing

## Applied migrations

| File | Effect |
|---|---|
| `003_fantasy_foundation.sql` | `matches.format` (team/singles/doubles), `teams.category`, `team_players.rating`/`position`/`credits`, RLS read policy |
| `004_team_players_fk.sql` | Adopted 56 orphans into placeholder teams, added the missing `team_players.team_id → teams.id` FK — **fixes `/api/admin/players`, which was returning 500 in production** |
| `005_rating_spread.sql` | Percentile-rank ratings within sport |
| `006_credit_curve.sql` | Credit curve `6 + rating × 0.5` |

All four are applied to the live project (`ejkqyvghtkwnvqwuzwtl`).

## Open questions

1. **6 placeholder teams named "Unidentified Squad 1–6"** now hold the 56
   previously-orphaned players (9–10 each, zero betting history), with
   `category = 'unassigned'` so they stay out of the `mens` admin queries. They
   are most likely the women's squads and need renaming once confirmed.
2. Whether cricket needs positional quotas after observing real lineups.
3. Whether the currently-open market should settle under old logic or be voided.
4. Whether the other five sports should keep the six house names or get their own
   — the seed assumed BCL is one inter-house tournament.

## Out of scope

- Fantasy for the other four sports
- Live/in-play fantasy substitutions
- Multiple parallel contests per match
- Season-long fantasy standings (per-match contests only for v1)

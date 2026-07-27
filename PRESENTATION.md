# PrimeStake — Engineering Review

A pari-mutuel prediction game and fantasy league built for a private multi-sport tournament.
Six sports, 17 players, one season in production.

*Figures below are pulled from the live database on 27 July 2026, not estimated.*

---

## 1. What it is

Players are issued in-game credits by an admin and spend them two ways: backing outcomes on
pool-based markets, or building a fantasy XI scored from real match statistics. Credits exist
only inside the app and cannot be bought or transferred out — the whole system is a way of
keeping score in a private tournament.

The interesting engineering problem is not the interface. It is that the app moves a balance
between accounts on every bet and every settlement, and once credits have moved, moving them
back is not always possible. Most of the work described here is about making that safe.

---

## 2. Season in numbers

**Window:** 25 February – 26 July 2026 (151 days)

| | |
|---|---|
| Registered players | 17 |
| Players who placed at least one bet | 8 (47%) |
| Bets placed | 180 |
| Total staked | 155,167 CR |
| Total paid out | 138,315 CR |
| Matches | 25 |
| Markets opened | 77 |
| Markets that attracted a bet | 44 of 77 |
| Ledger entries | 283 |

**Distribution of outcomes:** 73 bets won (41%), 105 lost (58%), 1 voided, 1 still pending.

**Engagement is concentrated.** The median active player placed 14 bets; the most active placed
64. Three players account for roughly 70% of all activity. This is the most honest number in the
deck — the product works, but it works for a core of about eight people rather than the whole
cohort of seventeen.

**Spread across sports:** cricket 9 matches, football 6, table tennis 3, pool 3, basketball 2,
volleyball 2. Seven distinct market types were used, with over/under (20), custom (23) and match
winner (20) dominating. The custom market type was added mid-season because admins kept wanting
markets the fixed types did not cover, such as top wicket-taker.

**Average stake 862 CR; largest single stake 5,000 CR; largest single payout 8,548 CR.**

### A number that needs explaining

Designed house edge is 5%. Measured retention across the season was 10.8% of player stakes.

That gap is deliberate and documented in the settlement engine. Every market opens with house
seed capital — 77,000 CR across the season — so that the first bet on a market does not see
absurd odds. The seed sits in the pool alongside real stakes, and the seed's share of the
*winning* option is never disbursed. That is how the house recovers the credits it put up. Seed
sitting on losing options does get distributed to winners, so it subsidises them.

So the 10.8% is the 5% edge plus house capital returning, not a second charge on players. Worth
stating plainly because the naive reading — "you designed 5% and took 11%" — is wrong, and it is
exactly the sort of thing worth catching before someone else catches it.

---

## 3. The security work

This is the part I would lead with.

### The anon key could mint credits

Supabase ships a public "anon key" inside the browser bundle. It is meant to be public; row-level
security is supposed to make it harmless. But PostgREST also exposes every Postgres function as a
callable HTTP endpoint, and by default those functions are executable by `PUBLIC`.

A review against production, using nothing but the key any visitor could read out of the
JavaScript, confirmed that anyone could:

- call `apply_settlement` with **attacker-chosen payouts** — `bet_id` was never checked against
  the market being settled, and the credited `user_id` was taken straight from the request
- call `place_bet` with an **arbitrary `p_user_id`** and drain any player's balance
- call `topup_wallet` and **issue themselves unlimited credits**

Ten functions were exposed this way. The fix was to `REVOKE ALL ... FROM PUBLIC, anon,
authenticated` on every one and grant `EXECUTE` only to `service_role`, which never leaves the
server. One function, `get_bet_estimates`, is legitimately called from the browser with the
user's own session, so it was granted to `authenticated` instead of being locked away entirely.

The lesson worth presenting: **RLS protects tables, not functions.** A `SECURITY DEFINER`
function runs with the definer's privileges and bypasses RLS by design. Every one is an
unauthenticated HTTP endpoint until you revoke it. This is now a written rule in the project —
every new function ships with its `REVOKE`/`GRANT` in the same migration, and an automated gate
fails the build if an anon caller ever succeeds.

### Settlement could pay twice

Two admins settling the same market at once — or one impatient admin double-clicking — could
credit every winner twice. There was no lock and no status check.

Settlement now takes `SELECT ... FOR UPDATE` on the market row as its **first** statement, then
refuses if the market is already settled. Bet placement takes the same lock, so the two
serialise. The order matters: taking the lock after reading is the same bug with extra steps.

### A legacy function was overpaying

An older `settle_market` was still in the database, paying `stake × odds_at_placement` — fixed
odds captured when the bet was placed. In a pari-mutuel system odds are not fixed; they move as
the pool moves. Paying the placement-time odds overpays whenever the pool shifts against the
house. It was dropped.

### Every payout is provably within its pool

Awards are rounded **down** to the paisa, never to nearest. Rounding to nearest lets a handful of
winners push the total above the pool, which quietly breaks solvency. The remainder stays with
the house. The database refuses any settlement whose awards exceed the pool, and refuses any
refund exceeding the fees actually collected — so even a bug in the application layer cannot
overdraw.

### Other controls

- **Row-level security on every table.** Fantasy lineups are readable only by their owner, so a
  rival cannot see your XI before the deadline. The standings endpoint returns names, points,
  rank and payout — never a lineup.
- **Admin routes verify the role server-side on every request.** Nothing relies on the client
  hiding a button.
- **The service role key is server-only** and never reaches the browser.
- **Client-submitted lineups are re-validated server-side** against a freshly loaded squad. The
  client's copy of the rules is a convenience; the server is the authority. A forged squad with
  cheap players would otherwise forge the budget.
- **Post-deploy verification gates** run against production and exit non-zero on failure. They
  check that no settled market ever overpaid, that every entry holds exactly eleven players, that
  anon callers are still refused, and that player balances are untouched.

---

## 4. Problems we hit, and how we got out of them

### Stale data that looked like missing data

The most recent one, and the most instructive.

A contest created in the admin panel did not appear on the contest list. The symptom was strange:
one page said "1 contest open" and the page one click away said "No fantasy contests yet" — same
database, same moment.

The cause was Next.js. It patches `fetch` and caches responses. The page was marked
`force-dynamic`, which re-renders on every request, but that does **not** stop the fetch inside
from being replayed out of the cache. The page had cached an empty result from before any contest
existed and served it thereafter. The other page escaped only because it used a different client
whose requests were not cached.

Two fixes came out of it. The direct one: the admin database client now sets `cache: 'no-store'`,
fixed once in the client rather than page by page — five pages read through it, including the
financial overview and the leaderboard, which had both been showing stale figures without anyone
noticing.

The second fix matters more. The bug was invisible because the code discarded query errors:

```ts
const { data } = await admin.from('contests').select(...)
```

A failed query and an empty table render identically. "No contests yet" was unfalsifiable. Errors
are now surfaced and logged, and empty states appear only when the data really is empty. The worst
case that fixed: a failed lookup of your own fantasy entry used to render an empty team builder to
someone who had already entered, as though their XI had vanished.

### The fantasy budget did not bite

The first pricing formula put every player between 5.5 and 10.0 credits against a 100-credit
budget. Measurement showed the eleven most expensive players in **all nine** fixtures cost between
95 and 99 — under budget. The constraint that was supposed to force hard choices forced nothing.

Repricing to `6 + rating × 0.5` moved an all-star XI to 121 credits and a budget XI to 71.5. Now
the budget binds. This is a small thing but a good example of testing a design assumption with
data rather than shipping it and hoping.

### A migration that could not be written the obvious way

Postgres will not let a transaction use an enum value that the same transaction added. The
migration runner posts each file as a single statement, so the two new transaction types had to
ship in a file of their own, before anything referencing them. Obvious in hindsight, easy to lose
an afternoon to.

### Settlement read two things that could disagree

Market option totals and the bets being settled were read in two separate queries. A bet landing
between them produced an option total lagging the bets actually owed, and settlement capacity
computed from stale totals could be less than the stakes it had to honour. Capacity is now derived
from whichever source is larger, which can only ever raise it.

### Verification baselines drift

The production gates hard-code expected row counts. Real activity moves them, so a gate that
should mean "something is wrong" starts meaning "someone placed a bet." They have been rebaselined
twice already, including once during this review. This is a genuine design weakness rather than a
solved problem: the counts should be derived from a recorded baseline rather than edited by hand.

---

## 5. How the work was done

**Rules live in pure, tested functions.** Scoring, lineup validation and prize distribution are
dependency-free modules with no database or network access, covered by **72 unit tests**. They run
identically in the browser for a live preview and on the server for settlement, so the two can
never disagree about the rules. Credits are applied by database functions that do nothing else.

**Root cause before fix.** The stale-data bug is a good example: the first hypothesis — a missing
environment variable in production — was tested and *disproved* before any code changed. Guessing
would have produced a plausible fix for the wrong problem.

**Verified rather than assumed.** The error-handling change was checked by injecting a deliberately
broken query and confirming the error state rendered and the empty state did not, then reverting.
The security lockdown was proven in both directions: anon callers must be refused, and
`service_role` must still get through — a revoke that is too broad breaks the app just as surely.

**Settlement is deliberately two actions.** Saving statistics is idempotent and moves no credits;
settling is one-time and guarded. The specification originally said re-publishing should recompute
points *and* payouts. That was rejected: recomputing payouts after credits have moved is precisely
the double-credit bug. Scores can be corrected as often as needed; credits move once.

---

## 6. Where it is weak

Worth saying out loud before anyone asks.

- **Adoption is narrow.** Eight of seventeen registered players ever placed a bet.
- **No end-to-end browser testing.** Everything is verified at the unit, HTTP and database layers.
  Nothing yet drives a real browser, so a purely visual regression could ship unnoticed.
- **No automated test covers the caching bug.** It was found by inspection and fixed by inspection.
  Framework-level caching is genuinely awkward to assert against, but "awkward" is not "impossible."
- **Verification baselines are hand-maintained**, as above.
- **Fantasy has one season of data and no completed contest.** The prize-distribution logic is
  thoroughly unit-tested, including ties and rounding, but has not yet paid out a real contest.

---

## 7. Summary

| | |
|---|---|
| Duration in production | 151 days |
| Sports supported | 6 |
| Markets settled | 50 |
| Credits moved through settlement | 138,315 CR |
| Critical vulnerabilities found and closed | 3 |
| Database functions locked down | 12 |
| Unit tests | 72 |
| Automated production gates | 3 |

The security findings are the substance here. An application that moves balances between accounts
had ten unauthenticated endpoints capable of minting credits, draining wallets and paying arbitrary
amounts to arbitrary people — and it looked completely fine from the outside, because the flaw was
in a layer that row-level security does not cover.

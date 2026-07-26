# Open follow-ups

Findings from the pari-mutuel rework's final review (2026-07-26) that were
deliberately not fixed in that branch. Ordered by urgency.

## P1 — New users get no `profiles` row on signup (PRE-EXISTING, affecting a real user)

**Not caused by the pari-mutuel work.** Broken since roughly 2026-02-25.

`001_schema.sql:136` creates `on_auth_user_created AFTER INSERT ON auth.users`,
which should insert a `profiles` row. Comparing `auth.users.created_at` against
`profiles.created_at` across all 18 auth users:

- The 5 users created on 2026-02-24 show gaps of −0.01s to 0.00s — the trigger
  firing in the same transaction. It used to work.
- Every user from 2026-02-25 onward shows gaps of 11 seconds to 14 hours. Those
  profiles were created lazily by the self-heal loop in
  `app/api/admin/users/route.ts:32-45`, which only runs when an admin opens the
  users page. That code's own comment ("users whose profile trigger may have
  failed") shows the problem was already suspected.
- **`naitiktrivedi21@gmail.com` (signed up 2026-03-08) has no profile at all.**
  They cannot place a bet — `place_bet` raises `Profile not found` — and their
  dashboard will not render.

Two test signups through the production `/auth/v1/signup` path produced zero
profile rows after 6 seconds of polling.

Likely cause: `CREATE TRIGGER ... ON auth.users` requires ownership of
`auth.users`, which the `postgres` role does not have on current Supabase
projects, so the trigger was probably lost or never recreated after a platform
change. Confirm in Dashboard → Database → Triggers.

**Fix:** recreate the trigger if possible, and regardless give `/api/bets` (and
`/api/topup`) an upsert-profile fallback so a user's ability to bet does not
depend on an admin happening to visit a page.

## N1 — Lock-order inversion between `void_bet` and `apply_settlement`

`void_bet` (`008_settlement_hardening.sql`) locks the **bets** row, then the
**markets** row. `apply_settlement` locks **markets** first, then bets rows in
its payout loop and straggler sweep. Reachable deadlock: void_bet holds bet B
waiting on market M while apply_settlement holds M waiting on B.

Postgres breaks it at `deadlock_timeout` with `40P01`. No money moves and
nothing corrupts — the admin sees a 500 and retries — so this is Minor.

**Fix:** have `void_bet` take the market row lock first, then the bet row.

## `get_bet_estimates` is an IDOR

The function is SECURITY DEFINER (bypasses RLS), takes `p_user_id`, and never
compares it to `auth.uid()`. It is granted to `authenticated` because
`app/dashboard/page.tsx:43` calls it with the user's own client.

Any logged-in user can therefore read any other user's pending-bet estimates.
`001_schema.sql:148` grants all authenticated users SELECT on every profile for
the leaderboard, so user ids are trivially enumerable — no guessing needed.

Exposure is `{bet_id, expected_payout}` on pending bets only: non-monetary, no
write path, and strictly better than the pre-fix state where it was callable by
anonymous users. Still wrong.

**Fix:** compare `p_user_id` to `auth.uid()` and raise on mismatch, or drop the
parameter and derive the user from the session.

## `get_bet_estimates` predates the current engine

Its SQL exists in **no migration in this repo** — `git log -S` traces it to
`ca9b102` (February), a commit that touched only `app/dashboard/page.tsx`. It
was created out of band and is live.

It therefore predates `bet_options.seed_amount`, the 1.1× early-bird weight, the
stake guarantee and the surplus cap. The estimate a bettor sees on their
dashboard is computed by a *different formula* from the one that pays them —
precisely what the plan's architecture was meant to prevent. A fresh environment
built from `supabase/migrations/` will 404 on it.

**Fix:** commit its definition into a migration, rewritten against
`lib/parimutuel.ts`, or drop it and compute the estimate server-side with
`settleMarket`.

## `scripts/verify-parimutuel.mjs` duplicates the algorithm it verifies

The gate inline-copies `safeNum`/`optionTotal`/`poolTotal`/`betWeight`/
`settleMarket` from `lib/parimutuel.ts`, with a comment admitting the copy must
be kept in sync. A gate carrying its own copy of the logic passes on exactly the
day the real module regresses.

The stated reason was no `tsx` in devDependencies. `vitest` is now a dependency
and can run a `.test.ts` gate directly.

## Historical ledger drift (cosmetic)

One `bet_options` row (`9c1c0159-4d96-4064-a873-85ffc7f3583b`, "Tushar Gupta")
records `total_amount_bet = 2000` against a bet voided under the old path that
did not decrement the pool, and `markets.total_pool` for `f036f419-…` matches.
That market is already settled, so nothing prices against it again. 678 of 679
`bet_options` rows reconcile exactly.

Separately, `get_financial_overview()` reports ₹197,780 cash collected because
historical `topup` rows from previously-voided bets inflate it. `void_bet` now
logs `refund` instead, so this stops growing, but the existing rows were not
backfilled.

## Minor, from the task ledger

- Early-bird cutoff uses strict `<`, so a bet placed at exactly
  `created_at + 30min` counts as late. Sub-millisecond window, no solvency
  impact. `<=` would be marginally fairer.
- `apply_settlement`'s capacity guard sums only `p_payouts`; the straggler sweep
  pays additional money not counted against it. Unreachable via the real caller,
  but the guard is weaker than `007`'s comment advertises.
- Duplicate `bet_id` rows in `p_payouts` are not rejected and would credit a
  wallet once per occurrence. Bounded by the capacity guard and unreachable via
  the real caller.
- The straggler sweep does not decrement `total_amount_bet` / `total_pool` the
  way `void_bet` does. Harmless — the market is settled in the same transaction.
- `008`'s header comments label the C3 and C4 findings backwards relative to the
  review. Both bugs are fixed; only the commentary misleads.

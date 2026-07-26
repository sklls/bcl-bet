-- ============================================================
-- 008_settlement_hardening.sql
--
-- Closes the security holes a final review found against production:
--
--   C1  Every SECURITY DEFINER function in `public` was EXECUTE-able by
--       PUBLIC (Postgres' default) and therefore by the `anon` role, which
--       PostgREST exposes at /rest/v1/rpc/<name>. Anyone holding the public
--       anon key could call apply_settlement with attacker-chosen payouts,
--       place_bet on behalf of any user, or top up any wallet.
--   C2  The pre-pari-mutuel settle_market() was still installed. It pays
--       amount * odds_at_placement — the exact overpay bug 007 removed.
--   C3  apply_settlement took no lock and checked no status, so two
--       concurrent settlements both saw status='open' and paid every
--       winner twice.
--   C4  A bet placed between the settle route's two reads appeared in
--       neither p_payouts nor p_losing_bet_ids and stayed 'pending' with
--       the stake already debited — permanently confiscated.
--   I1  Admin bet-voiding refunded the wallet but left
--       bet_options.total_amount_bet and markets.total_pool inflated. Under
--       pari-mutuel those columns are the cash figure settlement prices
--       against, so the house silently funded the gap.
--
-- 007 is already applied in production; it is not edited. Everything here
-- is additive or a replacement.
-- ============================================================

-- ------------------------------------------------------------
-- C2. Remove the legacy exploitable settle path.
--
-- Signature confirmed against pg_proc:
--   settle_market(p_market_id uuid, p_winning_option_id uuid)
-- Nothing in the application calls it any more — app/api/settle/route.ts
-- computes payouts in lib/parimutuel.ts and applies them via
-- apply_settlement.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS settle_market(UUID, UUID);

-- ------------------------------------------------------------
-- C3 + C4. apply_settlement: serialize, refuse double-settle, and sweep
-- stragglers so no stake is confiscated.
--
-- The market row is locked FOR UPDATE at the very top. place_bet takes the
-- same lock on the same row before it inserts, so a bet landing mid-settle
-- either commits before this transaction takes the lock (and is then caught
-- by the straggler sweep) or blocks until settlement commits and is then
-- rejected by place_bet's own 'Market is not open' check.
--
-- Defence in depth beyond the lock: every bet named in p_payouts must
-- actually be a pending bet on this market belonging to the claimed user,
-- and the losing-bet update is scoped to this market. The REVOKEs at the
-- bottom of this file are the real fix for C1, but the function no longer
-- trusts its arguments either.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_settlement(
  p_market_id UUID,
  p_winning_option_id UUID,
  p_payouts JSONB,          -- [{bet_id, user_id, amount}]
  p_losing_bet_ids UUID[],
  p_void BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_row JSONB;
  v_total NUMERIC := 0;
  v_capacity NUMERIC;
  v_label TEXT;
  v_count INT := 0;
  v_status market_status;
  v_swept INT := 0;
  v_straggler RECORD;
BEGIN
  -- C3: take the market row lock FIRST, then re-read status under it. Two
  -- concurrent callers serialize here; the loser sees 'settled' and aborts.
  SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_status = 'settled' THEN
    RAISE EXCEPTION 'Market already settled';
  END IF;

  -- The winning option must belong to this market (skipped on a void, where
  -- the caller may legitimately have no meaningful winner).
  IF NOT p_void AND NOT EXISTS (
    SELECT 1 FROM bet_options
    WHERE id = p_winning_option_id AND market_id = p_market_id
  ) THEN
    RAISE EXCEPTION 'Winning option does not belong to this market';
  END IF;

  -- Every payout row must name a pending bet on this market held by the
  -- claimed user, with a non-negative amount.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payouts) e
    LEFT JOIN bets b ON b.id = (e->>'bet_id')::UUID
    WHERE b.id IS NULL
       OR b.market_id IS DISTINCT FROM p_market_id
       OR b.status IS DISTINCT FROM 'pending'
       OR b.user_id IS DISTINCT FROM (e->>'user_id')::UUID
       OR (e->>'amount')::NUMERIC < 0
  ) THEN
    RAISE EXCEPTION 'Payout references a bet that is not pending on this market';
  END IF;

  SELECT COALESCE(SUM(total_amount_bet + seed_amount), 0) INTO v_capacity
  FROM bet_options WHERE market_id = p_market_id;

  SELECT COALESCE(SUM((e->>'amount')::NUMERIC), 0) INTO v_total
  FROM jsonb_array_elements(p_payouts) e;

  IF v_total > v_capacity + 0.01 THEN
    RAISE EXCEPTION 'Payout % exceeds market capacity %', v_total, v_capacity;
  END IF;

  SELECT label INTO v_label FROM bet_options WHERE id = p_winning_option_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payouts)
  LOOP
    UPDATE profiles
      SET wallet_balance = wallet_balance + (v_row->>'amount')::NUMERIC
      WHERE id = (v_row->>'user_id')::UUID;

    UPDATE bets
      SET status = CASE WHEN p_void THEN 'void'::bet_status ELSE 'won'::bet_status END,
          payout = (v_row->>'amount')::NUMERIC,
          settled_at = NOW()
      WHERE id = (v_row->>'bet_id')::UUID
        AND market_id = p_market_id;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (
      (v_row->>'user_id')::UUID,
      CASE WHEN p_void THEN 'refund'::transaction_type ELSE 'win'::transaction_type END,
      (v_row->>'amount')::NUMERIC,
      CASE WHEN p_void
        THEN 'Market voided — stake refunded'
        ELSE 'Bet won: ' || COALESCE(v_label, '') END,
      (v_row->>'bet_id')::UUID
    );
    v_count := v_count + 1;
  END LOOP;

  IF NOT p_void AND array_length(p_losing_bet_ids, 1) > 0 THEN
    UPDATE bets SET status = 'lost', payout = 0, settled_at = NOW()
    WHERE id = ANY(p_losing_bet_ids)
      AND market_id = p_market_id
      AND status = 'pending';
  END IF;

  -- C4: anything still pending on this market was never seen by the caller
  -- (it landed between the route's two reads). Its stake is already debited,
  -- so refund it rather than leave it stranded on a settled market. Same
  -- shape as the void path above: void the bet, credit the wallet, log a
  -- 'refund' transaction.
  FOR v_straggler IN
    SELECT id, user_id, amount
    FROM bets
    WHERE market_id = p_market_id AND status = 'pending'
    FOR UPDATE
  LOOP
    UPDATE profiles
      SET wallet_balance = wallet_balance + v_straggler.amount
      WHERE id = v_straggler.user_id;

    UPDATE bets
      SET status = 'void'::bet_status,
          payout = v_straggler.amount,
          settled_at = NOW()
      WHERE id = v_straggler.id;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (
      v_straggler.user_id,
      'refund'::transaction_type,
      v_straggler.amount,
      'Bet placed during settlement — stake refunded',
      v_straggler.id
    );
    v_swept := v_swept + 1;
  END LOOP;

  UPDATE markets
    SET status = 'settled',
        result = CASE WHEN p_void THEN 'VOID' ELSE v_label END,
        updated_at = NOW()
    WHERE id = p_market_id;

  RETURN json_build_object(
    'settled', v_count,
    'total_paid', v_total,
    'void', p_void,
    'swept', v_swept
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- I1. void_bet — atomic single-bet void.
--
-- app/api/admin/bets/route.ts used to call topup_wallet and then UPDATE the
-- bet, which refunded the money but left the money still counted in
-- bet_options.total_amount_bet and markets.total_pool. Under pari-mutuel
-- those columns ARE the pool: lib/parimutuel.ts prices against them and
-- apply_settlement's capacity guard reads the same inflated figure, so the
-- guard could not catch it. Everything now moves in one transaction.
--
-- The transaction is logged as 'refund', not 'topup'. app/admin/page.tsx
-- sums 'topup' rows as real cash collected from players, and a voided bet
-- is not cash collected.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_bet(
  p_bet_id UUID,
  p_description TEXT
) RETURNS JSON AS $$
DECLARE
  v_bet RECORD;
  v_market_status market_status;
BEGIN
  SELECT id, user_id, market_id, bet_option_id, amount, status
    INTO v_bet
    FROM bets WHERE id = p_bet_id FOR UPDATE;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending bets can be voided';
  END IF;

  -- Serialize against apply_settlement / place_bet on the same market.
  SELECT status INTO v_market_status
    FROM markets WHERE id = v_bet.market_id FOR UPDATE;
  IF v_market_status = 'settled' THEN
    RAISE EXCEPTION 'Market already settled';
  END IF;

  UPDATE profiles
    SET wallet_balance = wallet_balance + v_bet.amount
    WHERE id = v_bet.user_id;

  UPDATE bets
    SET status = 'void'::bet_status,
        settled_at = NOW()
    WHERE id = p_bet_id;

  INSERT INTO transactions (user_id, type, amount, description, reference_id)
  VALUES (
    v_bet.user_id,
    'refund'::transaction_type,
    v_bet.amount,
    COALESCE(p_description, 'Refund: bet voided by admin'),
    p_bet_id
  );

  -- Take the money back out of the pool it was added to. GREATEST guards
  -- against historical rows whose totals were already drifted.
  UPDATE bet_options
    SET total_amount_bet = GREATEST(total_amount_bet - v_bet.amount, 0)
    WHERE id = v_bet.bet_option_id;

  UPDATE markets
    SET total_pool = GREATEST(total_pool - v_bet.amount, 0),
        updated_at = NOW()
    WHERE id = v_bet.market_id;

  RETURN json_build_object('success', true, 'refunded', v_bet.amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- C1. Lock down every SECURITY DEFINER function in `public`.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and this
-- project additionally carries explicit anon/authenticated grants (verified
-- in pg_proc.proacl). PostgREST turns each one into an anon-callable RPC.
--
-- Rule applied below: anything that moves money or mutates data is
-- service_role only. Those are all reached exclusively through
-- createAdminClient() in lib/supabase-server.ts, so no user-facing path
-- changes.
-- ============================================================

-- --- Money movement / settlement -----------------------------
REVOKE ALL ON FUNCTION apply_settlement(UUID, UUID, JSONB, UUID[], BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_settlement(UUID, UUID, JSONB, UUID[], BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION place_bet(UUID, UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_bet(UUID, UUID, UUID, NUMERIC)
  TO service_role;

REVOKE ALL ON FUNCTION topup_wallet(UUID, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION topup_wallet(UUID, NUMERIC, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION void_bet(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION void_bet(UUID, TEXT)
  TO service_role;

-- --- Destructive admin resets --------------------------------
REVOKE ALL ON FUNCTION reset_wallet(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_wallet(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION reset_season()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_season() TO service_role;

REVOKE ALL ON FUNCTION reset_all_financials()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_all_financials() TO service_role;

REVOKE ALL ON FUNCTION reset_cash_collected()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_cash_collected() TO service_role;

-- --- Whole-book financial disclosure -------------------------
-- Read-only, but it returns the entire book's cash position. No application
-- code calls it; the admin dashboard aggregates transactions directly.
REVOKE ALL ON FUNCTION get_financial_overview()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_financial_overview() TO service_role;

-- --- Signup trigger ------------------------------------------
-- Fired by a trigger on auth.users. Postgres checks EXECUTE on a trigger
-- function at CREATE TRIGGER time, not at fire time, so removing the public
-- grant cannot break signup; the auth admin role is granted explicitly
-- anyway.
REVOKE ALL ON FUNCTION handle_new_user()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION handle_new_user() TO service_role, supabase_auth_admin;

-- --- Deliberately still reachable by logged-in users ---------
-- app/dashboard/page.tsx calls get_bet_estimates with the *user's* client
-- (createServerSupabaseClient, anon key + session cookie), so it must stay
-- callable by `authenticated`. It is read-only and takes p_user_id, so a
-- logged-in user can read another user's pending-bet estimates — an
-- acceptable, non-monetary exposure that is out of scope here. It is NOT
-- granted to anon.
REVOKE ALL ON FUNCTION get_bet_estimates(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_bet_estimates(UUID) TO authenticated, service_role;

-- ============================================================
-- 007_parimutuel.sql
--
-- Replaces locked odds with true pari-mutuel settlement.
--
-- Under the old engine place_bet stored odds_at_placement and settle_market
-- paid amount * odds_at_placement. That let a ₹1 stake on an untouched option
-- lock in ~95% of the whole pool (observed: ₹1 at 5700.95x). Payouts are now
-- computed from the pool at settlement, so a stake earns only its share.
-- ============================================================

-- ------------------------------------------------------------
-- 1. House seeding
-- ------------------------------------------------------------
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS seed_amount NUMERIC(10,2) NOT NULL DEFAULT 1000;

-- Per-option allocation, kept separate from total_amount_bet so house money
-- stays distinguishable from real stakes in accounting and the bettors list.
ALTER TABLE bet_options
  ADD COLUMN IF NOT EXISTS seed_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. Stake floor. Sub-rupee stakes were legal on a DECIMAL(10,2) column.
-- ------------------------------------------------------------
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_amount_check;
ALTER TABLE bets ADD CONSTRAINT bets_amount_check CHECK (amount >= 1);

-- odds_at_placement is history only from here on.
ALTER TABLE bets ALTER COLUMN odds_at_placement DROP NOT NULL;

-- ------------------------------------------------------------
-- 3. place_bet without odds
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS place_bet(UUID, UUID, UUID, DECIMAL, DECIMAL);

CREATE OR REPLACE FUNCTION place_bet(
  p_user_id UUID,
  p_market_id UUID,
  p_bet_option_id UUID,
  p_amount NUMERIC
) RETURNS JSON AS $$
DECLARE
  v_bet_id UUID;
  v_balance NUMERIC;
  v_status market_status;
BEGIN
  SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Market is not open for betting';
  END IF;

  SELECT wallet_balance INTO v_balance
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE profiles SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO bets (user_id, market_id, bet_option_id, amount)
  VALUES (p_user_id, p_market_id, p_bet_option_id, p_amount)
  RETURNING id INTO v_bet_id;

  UPDATE bet_options SET total_amount_bet = total_amount_bet + p_amount
  WHERE id = p_bet_option_id;

  UPDATE markets SET total_pool = total_pool + p_amount, updated_at = NOW()
  WHERE id = p_market_id;

  INSERT INTO transactions (user_id, type, amount, description, reference_id)
  VALUES (p_user_id, 'bet', -p_amount, 'Bet placed', v_bet_id);

  RETURN json_build_object('bet_id', v_bet_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Settlement application
--
-- Payouts are computed by lib/parimutuel.ts and passed in, so the maths stays
-- unit-testable. This function is the atomic applier and the last line of
-- defence: it refuses any settlement that would pay out more than the market
-- holds, whatever the caller claims.
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
BEGIN
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
      WHERE id = (v_row->>'bet_id')::UUID;

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
    WHERE id = ANY(p_losing_bet_ids);
  END IF;

  UPDATE markets
    SET status = 'settled',
        result = CASE WHEN p_void THEN 'VOID' ELSE v_label END,
        updated_at = NOW()
    WHERE id = p_market_id;

  RETURN json_build_object('settled', v_count, 'total_paid', v_total, 'void', p_void);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

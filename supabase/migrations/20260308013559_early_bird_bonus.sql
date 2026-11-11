-- ============================================================
-- MIGRATION 002: Early Bird Bonus in settle_market
-- Early bettors (placed within 30 min of market creation)
-- receive a +10% bonus on their payout.
-- ============================================================

CREATE OR REPLACE FUNCTION settle_market(
  p_market_id UUID,
  p_winning_option_id UUID
) RETURNS VOID AS $$
DECLARE
  bet RECORD;
  v_payout DECIMAL;
  v_winning_label TEXT;
  v_market_created_at TIMESTAMPTZ;
  v_early_bird_cutoff TIMESTAMPTZ;
  v_is_early BOOLEAN;
BEGIN
  SELECT label INTO v_winning_label FROM bet_options WHERE id = p_winning_option_id;
  SELECT created_at INTO v_market_created_at FROM markets WHERE id = p_market_id;

  -- Early bird window: first 30 minutes after market creation
  v_early_bird_cutoff := v_market_created_at + INTERVAL '30 minutes';

  -- Credit winning bets
  FOR bet IN
    SELECT b.id, b.user_id, b.amount, b.odds_at_placement, b.placed_at
    FROM bets b
    WHERE b.market_id = p_market_id
      AND b.bet_option_id = p_winning_option_id
      AND b.status = 'pending'
  LOOP
    v_is_early := bet.placed_at < v_early_bird_cutoff;
    v_payout := bet.amount * bet.odds_at_placement;

    -- Apply +10% bonus for early bettors
    IF v_is_early THEN
      v_payout := v_payout * 1.10;
    END IF;

    UPDATE profiles SET wallet_balance = wallet_balance + v_payout
    WHERE id = bet.user_id;

    UPDATE bets SET status = 'won', payout = v_payout, settled_at = NOW()
    WHERE id = bet.id;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (
      bet.user_id,
      'win',
      v_payout,
      CASE WHEN v_is_early
        THEN 'Bet won (⚡ early bird +10%): ' || v_winning_label
        ELSE 'Bet won: ' || v_winning_label
      END,
      bet.id
    );
  END LOOP;

  -- Mark losing bets
  UPDATE bets SET status = 'lost', payout = 0, settled_at = NOW()
  WHERE market_id = p_market_id
    AND bet_option_id != p_winning_option_id
    AND status = 'pending';

  -- Close market
  UPDATE markets
  SET status = 'settled', result = v_winning_label, updated_at = NOW()
  WHERE id = p_market_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

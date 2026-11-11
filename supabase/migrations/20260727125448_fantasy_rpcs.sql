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
  v_status    contest_status;
  v_pool      NUMERIC;
  v_fee       NUMERIC;
  v_entrants  INT;
  v_total     NUMERIC := 0;
  v_bad       INT;
  v_row       JSONB;
  v_count     INT := 0;
BEGIN
  SELECT status, prize_pool, entry_fee INTO v_status, v_pool, v_fee
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

  IF p_void THEN
    -- A void hands back the fees themselves, which legitimately exceed the
    -- edged pool — so the pool cap cannot apply. It still needs A cap, or the
    -- void path is an unbounded write. The ceiling is what was actually
    -- collected: entry_fee x entrants.
    SELECT COUNT(*) INTO v_entrants FROM contest_entries WHERE contest_id = p_contest_id;
    IF v_total > (v_fee * v_entrants) + 0.01 THEN
      RAISE EXCEPTION 'Refunds % exceed fees collected %', v_total, v_fee * v_entrants;
    END IF;
  ELSIF v_total > v_pool + 0.01 THEN
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

-- ============================================================
-- 006_credit_curve.sql — Run in Supabase SQL Editor
--
-- 003 priced players at  credits = 5 + rating * 0.5  →  range 5.5 - 10.0.
-- With a 100 credit budget for 11 players the affordable average is 9.09,
-- which sits 80% of the way up that range — so nearly any XI fits and the
-- budget never forces a choice. Measured: the eleven most expensive players
-- in every fixture cost 95-99, under budget in all nine.
--
-- Shift the curve up so 9.09 sits ~58% of the range, matching how Dream11
-- balances its own 100-credit budget:
--
--   credits = 6 + rating * 0.5   →   range 6.5 - 11.0
--     all-star XI  11 x 11.0 = 121   unaffordable
--     budget XI    11 x  6.5 = 71.5  comfortable
-- ============================================================

ALTER TABLE team_players DROP COLUMN IF EXISTS credits;

ALTER TABLE team_players
  ADD COLUMN credits NUMERIC(4,1)
  GENERATED ALWAYS AS (6 + rating * 0.5) STORED;

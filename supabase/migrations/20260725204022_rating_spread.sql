-- ============================================================
-- 005_rating_spread.sql — Run in Supabase SQL Editor
--
-- 003 derived ratings from the auction bid with round(2 + bid * 0.30).
-- That is faithful to the auction but produces a useless fantasy budget:
-- real bids cluster low (most players went for 2-9 as Novices), so cricket
-- averaged 4.9/10 and the eleven most expensive players in a fixture cost
-- only 95 of the 100 credit budget. No trade-off, no game.
--
-- Rank within sport instead. Percentile ranking guarantees a full 1-10 spread
-- whatever the underlying bid distribution, so the budget always bites.
-- These are starting values; the admin curates from here.
-- ============================================================

WITH ranked AS (
  SELECT
    tp.id,
    1 + FLOOR(
      9 * PERCENT_RANK() OVER (
        PARTITION BY t.sport
        ORDER BY tp.bid_amount NULLS FIRST, tp.name
      )
    )::INT AS new_rating
  FROM team_players tp
  JOIN teams t ON t.id = tp.team_id
)
UPDATE team_players tp
SET rating = LEAST(10, GREATEST(1, r.new_rating))
FROM ranked r
WHERE r.id = tp.id;

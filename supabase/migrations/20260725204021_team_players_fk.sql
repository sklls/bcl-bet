-- ============================================================
-- 004_team_players_fk.sql — Run in Supabase SQL Editor
--
-- Adds the missing teams <- team_players foreign key. Without it PostgREST
-- cannot resolve the embed used by app/api/admin/players/route.ts:29, so that
-- route returns 500 ("Could not find a relationship between 'teams' and
-- 'team_players' in the schema cache").
--
-- The FK cannot be added while orphaned rows exist, so unidentified squads are
-- first given placeholder teams. Nothing is deleted.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Adopt orphaned squads into placeholder teams.
--    6 squads / 56 players with no betting history, likely the women's teams.
--    category='unassigned' keeps them out of the 'mens' admin queries until
--    they're identified and renamed.
-- ------------------------------------------------------------
WITH orphans AS (
  SELECT DISTINCT tp.team_id
  FROM team_players tp
  LEFT JOIN teams t ON t.id = tp.team_id
  WHERE tp.team_id IS NOT NULL AND t.id IS NULL
),
numbered AS (
  SELECT team_id, ROW_NUMBER() OVER (ORDER BY team_id) AS n FROM orphans
)
INSERT INTO teams (id, name, sport, category)
SELECT team_id, 'Unidentified Squad ' || n, 'cricket', 'unassigned'
FROM numbered;

-- ------------------------------------------------------------
-- 2. Now the FK can be created.
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE team_players
    ADD CONSTRAINT team_players_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 3. Fix seeded dummy ratings.
--    003 mapped bid_amount through the auction formula (round(2 + bid*0.30)),
--    which is right for real cricket players (bids 2-42) but wrong for the
--    seeded squads, where bid_amount was already a 3-10 rating. That squashed
--    every dummy player into 3-5 and flattened the credit spread.
-- ------------------------------------------------------------
UPDATE team_players tp
SET rating = LEAST(10, GREATEST(1, tp.bid_amount))
FROM teams t
WHERE t.id = tp.team_id
  AND t.sport <> 'cricket'
  AND tp.bid_amount BETWEEN 1 AND 10;

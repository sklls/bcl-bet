-- ============================================================
-- 003_fantasy_foundation.sql — Run in Supabase SQL Editor
--
-- Schema drift note: 001/002 do not reflect production. The live DB already
-- has markets.title and a team_players table (id, team_id, name, role,
-- bid_amount, batch) that neither migration creates. This file is written
-- against the LIVE schema as introspected on 2026-07-25.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Match format — singles / doubles for TT and Pool
--    For non-'team' formats, matches.team_a/team_b hold the player
--    name ("Uday Iyer") or the pair ("Karan Nair / Yash Tiwari").
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE match_format AS ENUM ('team', 'singles', 'doubles');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS format match_format NOT NULL DEFAULT 'team';

-- Backfill the seeded individual-sport fixtures
UPDATE matches SET format = 'doubles'
  WHERE sport IN ('table_tennis', 'pool') AND team_a LIKE '% / %';
UPDATE matches SET format = 'singles'
  WHERE sport IN ('table_tennis', 'pool') AND team_a NOT LIKE '% / %';

-- ------------------------------------------------------------
-- 2. teams.category — app/api/admin/players/route.ts:31 already
--    filters on this column, so that route 500s in production today.
-- ------------------------------------------------------------
ALTER TABLE teams ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'mens';

-- ------------------------------------------------------------
-- 3. Fantasy player attributes
--    rating: admin's 1-10 score.  credits: derived price, 5.5 - 10.0.
--    bid_amount (auction, 2-28) seeds the initial rating.
-- ------------------------------------------------------------
ALTER TABLE team_players
  ADD COLUMN IF NOT EXISTS rating   SMALLINT CHECK (rating BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS position TEXT;

-- Seed ratings from auction price so 139 players don't need manual entry.
-- Buckets chosen so the 2-28 bid range spreads across 3-10.
UPDATE team_players SET rating = LEAST(10, GREATEST(1, ROUND(2 + bid_amount * 0.30)))
  WHERE rating IS NULL AND bid_amount IS NOT NULL;
UPDATE team_players SET rating = 5 WHERE rating IS NULL;

ALTER TABLE team_players ALTER COLUMN rating SET NOT NULL;
ALTER TABLE team_players ALTER COLUMN rating SET DEFAULT 5;

ALTER TABLE team_players
  ADD COLUMN IF NOT EXISTS credits NUMERIC(4,1)
  GENERATED ALWAYS AS (5 + rating * 0.5) STORED;

-- ------------------------------------------------------------
-- 4. Read access for the public fantasy/squad UI
-- ------------------------------------------------------------
ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Anyone can view team players" ON team_players FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 5. NOT DONE: FK team_players.team_id -> teams.id
--    56 rows across 6 team_ids are still orphaned (the unidentified
--    squads of 9-10 players). Adding the FK would fail while they
--    exist. Resolve those first, then:
--      ALTER TABLE team_players
--        ADD CONSTRAINT team_players_team_id_fkey
--        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_team_players_team_id ON team_players(team_id);
CREATE INDEX IF NOT EXISTS idx_matches_sport_status ON matches(sport, status);

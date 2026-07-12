-- ============================================================
-- 002_multisport.sql — Run in Supabase SQL Editor
-- ============================================================

-- 1. Sport type enum
CREATE TYPE sport_type AS ENUM (
  'cricket', 'football', 'table_tennis', 'volleyball', 'pool', 'basketball'
);

-- 2. Teams table
CREATE TABLE teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  sport sport_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view teams" ON teams FOR SELECT USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE teams;

-- 3. Add sport column to matches (existing rows become 'cricket')
ALTER TABLE matches ADD COLUMN sport sport_type NOT NULL DEFAULT 'cricket';

-- 4. Drop cricket-specific columns
ALTER TABLE matches
  DROP COLUMN IF EXISTS cricheroes_match_id,
  DROP COLUMN IF EXISTS cricheroes_slug,
  DROP COLUMN IF EXISTS live_score_a,
  DROP COLUMN IF EXISTS live_score_b,
  DROP COLUMN IF EXISTS live_overs_a,
  DROP COLUMN IF EXISTS live_overs_b,
  DROP COLUMN IF EXISTS live_crr,
  DROP COLUMN IF EXISTS live_rrr,
  DROP COLUMN IF EXISTS over_under_line;

-- 5. New market_type enum values
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'first_goal_scorer';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'set_winner';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'handicap';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'frame_handicap';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'custom';

-- 6. Season reset RPC (deletes all match/bet/team data, zeros wallets)
CREATE OR REPLACE FUNCTION reset_season() RETURNS VOID AS $$
BEGIN
  DELETE FROM bets;              -- remove before markets (no CASCADE on FK)
  DELETE FROM matches;           -- cascades: markets, bet_options, players
  DELETE FROM teams;
  DELETE FROM transactions;
  UPDATE profiles SET wallet_balance = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

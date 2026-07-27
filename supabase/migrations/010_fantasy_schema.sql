-- ============================================================
-- 010_fantasy_schema.sql
--
-- Dream11-style fantasy for cricket and football. Contests pool entry
-- fees exactly like a betting market: fees in, 5% house edge, the rest
-- distributed — by rank rather than by outcome.
-- ============================================================

CREATE TABLE IF NOT EXISTS contests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_fee      NUMERIC(10,2) NOT NULL DEFAULT 100 CHECK (entry_fee >= 0),
  house_edge_pct NUMERIC(4,2)  NOT NULL DEFAULT 5.0 CHECK (house_edge_pct >= 0 AND house_edge_pct <= 20),
  status         contest_status NOT NULL DEFAULT 'open',
  prize_pool     NUMERIC(12,2) NOT NULL DEFAULT 0,
  locks_at       TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id)
);

CREATE TABLE IF NOT EXISTS contest_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contest_id      UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  captain_id      UUID REFERENCES team_players(id),
  vice_captain_id UUID REFERENCES team_players(id),
  total_points    NUMERIC(8,2),
  rank            INT,
  payout          NUMERIC(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS entry_players (
  entry_id  UUID NOT NULL REFERENCES contest_entries(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES team_players(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_match_stats (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES team_players(id) ON DELETE CASCADE,
  played      BOOLEAN NOT NULL DEFAULT false,
  -- cricket
  runs        INT NOT NULL DEFAULT 0 CHECK (runs     >= 0),
  wickets     INT NOT NULL DEFAULT 0 CHECK (wickets  >= 0),
  catches     INT NOT NULL DEFAULT 0 CHECK (catches  >= 0),
  sixes       INT NOT NULL DEFAULT 0 CHECK (sixes    >= 0),
  run_outs    INT NOT NULL DEFAULT 0 CHECK (run_outs >= 0),
  -- football
  goals       INT NOT NULL DEFAULT 0 CHECK (goals   >= 0),
  assists     INT NOT NULL DEFAULT 0 CHECK (assists >= 0),
  saves       INT NOT NULL DEFAULT 0 CHECK (saves   >= 0),
  clean_sheet BOOLEAN NOT NULL DEFAULT false,
  yellows     INT NOT NULL DEFAULT 0 CHECK (yellows >= 0),
  reds        INT NOT NULL DEFAULT 0 CHECK (reds    >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_contests_match       ON contests(match_id);
CREATE INDEX IF NOT EXISTS idx_entries_contest      ON contest_entries(contest_id);
CREATE INDEX IF NOT EXISTS idx_entries_user         ON contest_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entry_players_entry  ON entry_players(entry_id);
CREATE INDEX IF NOT EXISTS idx_stats_match          ON player_match_stats(match_id);

-- ------------------------------------------------------------
-- RLS. Lineups stay private until the contest locks: a rival's XI
-- before the deadline is a competitive leak. Standings are served by
-- app/api/fantasy/leaderboard, which returns no lineup at all.
-- ------------------------------------------------------------
ALTER TABLE contests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_match_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Anyone can view contests" ON contests FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users see own entries" ON contest_entries
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users see own entry players" ON entry_players
    FOR SELECT USING (EXISTS (
      SELECT 1 FROM contest_entries e
      WHERE e.id = entry_players.entry_id AND e.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can view player stats" ON player_match_stats
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No INSERT/UPDATE/DELETE policies anywhere: every write goes through a
-- SECURITY DEFINER RPC called with the service-role key from a server route.

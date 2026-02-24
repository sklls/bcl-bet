-- ============================================================
-- BCL Bet - Full Schema Migration
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE match_status AS ENUM ('upcoming', 'live', 'completed', 'cancelled');
CREATE TYPE market_type AS ENUM ('winner', 'top_scorer', 'over_under', 'live');
CREATE TYPE market_status AS ENUM ('open', 'closed', 'settled');
CREATE TYPE bet_status AS ENUM ('pending', 'won', 'lost', 'void');
CREATE TYPE transaction_type AS ENUM ('bet', 'win', 'topup', 'refund');

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles (one per auth user)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role user_role DEFAULT 'user' NOT NULL,
  display_name TEXT NOT NULL,
  wallet_balance DECIMAL(12,2) DEFAULT 0 CHECK (wallet_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Matches
CREATE TABLE matches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  venue TEXT,
  status match_status DEFAULT 'upcoming',
  over_under_line DECIMAL(6,1),
  cricheroes_match_id TEXT,
  cricheroes_slug TEXT,
  -- Live score fields (synced by cron)
  live_score_a TEXT,
  live_score_b TEXT,
  live_overs_a TEXT,
  live_overs_b TEXT,
  live_crr TEXT,
  live_rrr TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players (for top scorer market)
CREATE TABLE players (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  team TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Markets (one per bet type per match)
CREATE TABLE markets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  market_type market_type NOT NULL,
  status market_status DEFAULT 'closed',
  result TEXT,
  total_pool DECIMAL(12,2) DEFAULT 0,
  house_edge_pct DECIMAL(4,2) DEFAULT 5.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bet Options (choices within a market)
CREATE TABLE bet_options (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  total_amount_bet DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bets
CREATE TABLE bets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  market_id UUID REFERENCES markets(id),
  bet_option_id UUID REFERENCES bet_options(id),
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  odds_at_placement DECIMAL(8,4) NOT NULL,
  status bet_status DEFAULT 'pending',
  payout DECIMAL(12,2),
  placed_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- Transactions
CREATE TABLE transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type transaction_type NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_market_id ON bets(market_id);
CREATE INDEX idx_bets_status ON bets(status);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_markets_match_id ON markets(match_id);
CREATE INDEX idx_bet_options_market_id ON bet_options(market_id);

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
-- Allow leaderboard: all authenticated users can read all profiles (display_name + wallet_balance only)
CREATE POLICY "Authenticated users can view all profiles for leaderboard" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view matches" ON matches FOR SELECT USING (true);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view markets" ON markets FOR SELECT USING (true);

ALTER TABLE bet_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view bet options" ON bet_options FOR SELECT USING (true);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view players" ON players FOR SELECT USING (true);

ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own bets" ON bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bets" ON bets FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE bet_options;
ALTER PUBLICATION supabase_realtime ADD TABLE markets;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;

-- ============================================================
-- LEADERBOARD VIEW
-- ============================================================
CREATE VIEW leaderboard AS
SELECT
  p.id,
  p.display_name,
  p.wallet_balance,
  COALESCE(SUM(CASE WHEN t.type = 'win' THEN t.amount ELSE 0 END), 0) AS total_winnings,
  COUNT(CASE WHEN b.status = 'won' THEN 1 END) AS bets_won,
  COUNT(b.id) AS total_bets
FROM profiles p
LEFT JOIN transactions t ON t.user_id = p.id
LEFT JOIN bets b ON b.user_id = p.id
GROUP BY p.id, p.display_name, p.wallet_balance
ORDER BY total_winnings DESC;

-- ============================================================
-- ATOMIC RPC: PLACE BET
-- ============================================================
CREATE OR REPLACE FUNCTION place_bet(
  p_user_id UUID,
  p_market_id UUID,
  p_bet_option_id UUID,
  p_amount DECIMAL,
  p_odds DECIMAL
) RETURNS JSON AS $$
DECLARE
  v_bet_id UUID;
  v_balance DECIMAL;
BEGIN
  -- Lock user row to prevent race conditions
  SELECT wallet_balance INTO v_balance
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Deduct wallet
  UPDATE profiles SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  -- Create bet
  INSERT INTO bets (user_id, market_id, bet_option_id, amount, odds_at_placement)
  VALUES (p_user_id, p_market_id, p_bet_option_id, p_amount, p_odds)
  RETURNING id INTO v_bet_id;

  -- Update bet_option total (triggers realtime)
  UPDATE bet_options SET total_amount_bet = total_amount_bet + p_amount
  WHERE id = p_bet_option_id;

  -- Update market pool
  UPDATE markets SET total_pool = total_pool + p_amount, updated_at = NOW()
  WHERE id = p_market_id;

  -- Log transaction
  INSERT INTO transactions (user_id, type, amount, description, reference_id)
  VALUES (p_user_id, 'bet', -p_amount, 'Bet placed', v_bet_id);

  RETURN json_build_object('bet_id', v_bet_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ATOMIC RPC: SETTLE MARKET
-- ============================================================
CREATE OR REPLACE FUNCTION settle_market(
  p_market_id UUID,
  p_winning_option_id UUID
) RETURNS VOID AS $$
DECLARE
  bet RECORD;
  v_payout DECIMAL;
  v_winning_label TEXT;
BEGIN
  SELECT label INTO v_winning_label FROM bet_options WHERE id = p_winning_option_id;

  -- Credit winning bets
  FOR bet IN
    SELECT b.id, b.user_id, b.amount, b.odds_at_placement
    FROM bets b
    WHERE b.market_id = p_market_id
      AND b.bet_option_id = p_winning_option_id
      AND b.status = 'pending'
  LOOP
    v_payout := bet.amount * bet.odds_at_placement;

    UPDATE profiles SET wallet_balance = wallet_balance + v_payout
    WHERE id = bet.user_id;

    UPDATE bets SET status = 'won', payout = v_payout, settled_at = NOW()
    WHERE id = bet.id;

    INSERT INTO transactions (user_id, type, amount, description, reference_id)
    VALUES (bet.user_id, 'win', v_payout, 'Bet won: ' || v_winning_label, bet.id);
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

-- ============================================================
-- ATOMIC RPC: TOPUP WALLET
-- ============================================================
CREATE OR REPLACE FUNCTION topup_wallet(
  p_user_id UUID,
  p_amount DECIMAL,
  p_description TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE profiles SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, description)
  VALUES (p_user_id, 'topup', p_amount, p_description);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PROMOTE FIRST ADMIN (run manually after first signup)
-- UPDATE profiles SET role = 'admin' WHERE id = 'your-user-uuid-here';
-- ============================================================

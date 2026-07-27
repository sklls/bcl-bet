-- ============================================================
-- 009_fantasy_enums.sql
--
-- Enum changes ONLY, deliberately alone in this file.
-- ALTER TYPE ... ADD VALUE cannot be used inside the same transaction
-- that adds it, and the migration runner posts each file as one query.
-- Migration 010 is the first file allowed to reference these values.
-- ============================================================

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'fantasy_entry';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'fantasy_prize';

DO $$ BEGIN
  CREATE TYPE contest_status AS ENUM ('open', 'locked', 'settled', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

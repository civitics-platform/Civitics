-- Add home_state / home_district to user_preferences for the USER node (FIX-042).
-- home_jurisdiction_id (existing FK) is retained for future geo-level joins.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS home_state    TEXT,  -- 2-char abbrev, e.g. 'CO'
  ADD COLUMN IF NOT EXISTS home_district INT;   -- House CD number; NULL = not set

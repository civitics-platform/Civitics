-- Add 'problem' value to initiative_stage enum
-- Allows civic_initiatives rows to represent open problem statements
-- (no solution yet) that can be turned into full initiatives later.

ALTER TYPE public.initiative_stage ADD VALUE IF NOT EXISTS 'problem';

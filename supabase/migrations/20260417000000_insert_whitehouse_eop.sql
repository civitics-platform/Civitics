-- Migration: Insert White House / Executive Office of the President
-- This is the most recognizable entity in U.S. governance and deserves a
-- prominent featured card at the top of /agencies.

INSERT INTO agencies (
  id,
  name,
  short_name,
  acronym,
  agency_type,
  website_url,
  description,
  is_active,
  jurisdiction_id,
  metadata,
  source_ids
) VALUES (
  'ffffffff-0000-0000-0000-000000000001',
  'Executive Office of the President',
  'White House',
  'EOP',
  'federal',
  'https://www.whitehouse.gov',
  'The Executive Office of the President (EOP) consists of the immediate staff of the President of the United States, as well as multiple levels of support staff reporting to the President. It includes the White House Office, the Office of Management and Budget, the National Security Council, the Council of Economic Advisers, and other key advisory and policy bodies.',
  true,
  'a5a601af-7c12-4f3f-98ec-cca2f88add59',  -- United States jurisdiction
  '{"featured": true, "display_name": "White House / EOP", "is_whitehouse": true}'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

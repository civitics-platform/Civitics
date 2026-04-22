-- Migration: Insert White House / Executive Office of the President
-- This is the most recognizable entity in U.S. governance and deserves a
-- prominent featured card at the top of /agencies.

-- Seed the United States jurisdiction row if not present. fips_code='00'
-- matches the criteria the data-seeder (packages/data/src/jurisdictions/
-- us-states.ts) uses to find an existing federal row, so subsequent seed
-- runs will pick up this row instead of creating a duplicate. No-op on
-- dbs where the jurisdiction has already been seeded.
INSERT INTO jurisdictions (
  id, type, name, short_name, country_code, fips_code, is_active, metadata
)
SELECT
  'a5a601af-7c12-4f3f-98ec-cca2f88add59',
  'country',
  'United States',
  'US',
  'US',
  '00',
  true,
  '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM jurisdictions WHERE fips_code = '00' AND type = 'country'
);

-- Agency points at whichever country jurisdiction row exists
-- (either the one inserted above, or one seeded earlier).
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
)
SELECT
  'ffffffff-0000-0000-0000-000000000001',
  'Executive Office of the President',
  'White House',
  'EOP',
  'federal',
  'https://www.whitehouse.gov',
  'The Executive Office of the President (EOP) consists of the immediate staff of the President of the United States, as well as multiple levels of support staff reporting to the President. It includes the White House Office, the Office of Management and Budget, the National Security Council, the Council of Economic Advisers, and other key advisory and policy bodies.',
  true,
  j.id,
  '{"featured": true, "display_name": "White House / EOP", "is_whitehouse": true}'::jsonb,
  '{}'::jsonb
FROM jurisdictions j
WHERE j.fips_code = '00' AND j.type = 'country'
LIMIT 1
ON CONFLICT (id) DO NOTHING;

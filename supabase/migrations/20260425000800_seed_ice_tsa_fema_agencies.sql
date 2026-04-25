-- Seed missing high-profile DHS sub-agencies: ICE, TSA, FEMA.
-- These appear frequently in USASpending contract data as awarding_sub_agency_name
-- but were absent from the agencies table, leaving their contracts unattributed.

INSERT INTO agencies (name, acronym, jurisdiction_id, parent_agency_id, website_url, metadata)
SELECT
  'Immigration and Customs Enforcement',
  'ICE',
  dhs.jurisdiction_id,
  dhs.id,
  'https://www.ice.gov',
  '{"founded": "2003"}'::jsonb
FROM agencies dhs
WHERE dhs.acronym = 'DHS'
ON CONFLICT (acronym) DO NOTHING;

INSERT INTO agencies (name, acronym, jurisdiction_id, parent_agency_id, website_url, metadata)
SELECT
  'Transportation Security Administration',
  'TSA',
  dhs.jurisdiction_id,
  dhs.id,
  'https://www.tsa.gov',
  '{"founded": "2001"}'::jsonb
FROM agencies dhs
WHERE dhs.acronym = 'DHS'
ON CONFLICT (acronym) DO NOTHING;

INSERT INTO agencies (name, acronym, jurisdiction_id, parent_agency_id, website_url, metadata)
SELECT
  'Federal Emergency Management Agency',
  'FEMA',
  dhs.jurisdiction_id,
  dhs.id,
  'https://www.fema.gov',
  '{"founded": "1979"}'::jsonb
FROM agencies dhs
WHERE dhs.acronym = 'DHS'
ON CONFLICT (acronym) DO NOTHING;

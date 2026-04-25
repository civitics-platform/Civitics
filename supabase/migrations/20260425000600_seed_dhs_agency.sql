-- Seed Department of Homeland Security — missed from FIX-107 top-agencies list.
-- ON CONFLICT (acronym) DO NOTHING for idempotency.
INSERT INTO public.agencies (
  id, jurisdiction_id, name, short_name, acronym, agency_type,
  website_url, description, is_active, source_ids, metadata
)
SELECT
  'ffffffff-0000-0000-0000-000000000008'::uuid,
  j.id,
  'Department of Homeland Security',
  'DHS',
  'DHS',
  'federal',
  'https://www.dhs.gov',
  'The Department of Homeland Security leads the unified national effort to secure the country and preserve American freedoms, coordinating efforts to prevent terrorism, secure borders, enforce immigration laws, safeguard cyberspace, and ensure disaster resilience.',
  true,
  '{}'::jsonb,
  '{}'::jsonb
FROM public.jurisdictions j
WHERE j.fips_code = '00' AND j.type = 'country'
LIMIT 1
ON CONFLICT (acronym) DO NOTHING;

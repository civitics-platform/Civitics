-- =============================================================================
-- FIX-107 — Seed 6 missing top-20 federal agencies
--
-- DOD, TREAS, DOS, DOL, GSA, SSA are absent from public.agencies on Pro.
-- The USASpending pipeline builds an acronym → UUID map at startup; any agency
-- not found emits "no matching agency — skipping", silently dropping ~30% of
-- contract volume.  Regulations.gov insert-on-miss only seeds agencies that
-- post rulemaking proposals, so these six were never auto-created.
--
-- Uses ON CONFLICT (acronym) DO NOTHING — idempotent on instances where some
-- of these already exist (e.g. local dev where DOD/DOS/TREAS landed via
-- regulations.gov pipeline).
-- =============================================================================

INSERT INTO public.agencies (
  id,
  jurisdiction_id,
  name,
  short_name,
  acronym,
  agency_type,
  website_url,
  description,
  is_active,
  source_ids,
  metadata
)
SELECT
  a.id,
  j.id AS jurisdiction_id,
  a.name,
  a.short_name,
  a.acronym,
  'federal',
  a.website_url,
  a.description,
  true,
  a.source_ids,
  '{}'::jsonb
FROM (VALUES
  (
    'ffffffff-0000-0000-0000-000000000002'::uuid,
    'Department of Defense',
    'DoD',
    'DOD',
    'https://www.defense.gov',
    'The Department of Defense provides the military forces needed to deter war and ensure national security. It is the largest government agency by budget and personnel, overseeing the Army, Navy, Marine Corps, Air Force, Space Force, and Coast Guard.',
    '{"regulations_gov_agency_id": "DOD"}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000003'::uuid,
    'Department of the Treasury',
    'Treasury',
    'TREAS',
    'https://home.treasury.gov',
    'The Department of the Treasury manages federal finances, collects taxes, produces currency and coinage, manages government accounts and public debt, and enforces financial and tax laws.',
    '{"regulations_gov_agency_id": "TREAS"}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000004'::uuid,
    'Department of State',
    'State Dept.',
    'DOS',
    'https://www.state.gov',
    'The Department of State leads America''s foreign policy through diplomacy, advocacy, and assistance by advancing the interests of the American people, their safety and economic prosperity.',
    '{"regulations_gov_agency_id": "DOS"}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000005'::uuid,
    'Department of Labor',
    'DOL',
    'DOL',
    'https://www.dol.gov',
    'The Department of Labor fosters, promotes, and develops the welfare of the wage earners of the United States, improving their working conditions, and advancing their opportunities for profitable employment.',
    '{}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000006'::uuid,
    'General Services Administration',
    'GSA',
    'GSA',
    'https://www.gsa.gov',
    'The General Services Administration provides centralized procurement and management of the federal government''s real estate portfolio, acquires products and services, and provides policy guidance to federal agencies.',
    '{}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000007'::uuid,
    'Social Security Administration',
    'SSA',
    'SSA',
    'https://www.ssa.gov',
    'The Social Security Administration administers Social Security, a social insurance program consisting of retirement, disability, and survivor benefits. SSA also administers Supplemental Security Income (SSI).',
    '{}'::jsonb
  )
) AS a(id, name, short_name, acronym, website_url, description, source_ids)
CROSS JOIN (
  SELECT id FROM public.jurisdictions WHERE fips_code = '00' AND type = 'country' LIMIT 1
) j
ON CONFLICT (acronym) DO NOTHING;

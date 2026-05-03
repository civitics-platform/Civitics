-- 20260502130000_financial_entities_partial_indexes.sql
-- FIX-195 (lean PAC-side indexes after FIX-181 indiv ingest).
--
-- After FIX-181 landed 435K individual donors into financial_entities, three
-- name-side indexes carry rows that no app call site ever queries:
--
--   * financial_entities_display_trgm        (GIN, ~29 MB)
--   * financial_entities_canonical           (btree, ~18 MB)
--   * financial_entities_canonical_name_type (btree, ~16 MB)
--
-- App audit: every display_name ilike in app/ targets PACs/corps; the
-- two callers that filter without `entity_type IN (...)` (search/route.ts
-- and search/page.tsx) are already broken (use the wrong column `name`)
-- and would not want to flood results with 248 individuals named GOLDMAN
-- once they're fixed. canonical_name is written by every pipeline but
-- never queried from app code — the two btrees are pure search support.
--
-- Make all three partial on `entity_type <> 'individual'`. Result on local
-- (post-FIX-181 first run): trgm bitmap for "goldman" goes from 249 hits
-- (1 corp + 248 individuals) to 1; total index size on the table drops by
-- ~96% of the individual share. PAC/corp lookups stop paying for the
-- individual rows.
--
-- Defer:
--   * Splitting individuals into a dedicated table (FIX-191 option a) —
--     real cardinality is O(10⁶), not the O(10⁷) the bullet feared, and
--     entity_tags / canonical_name UNIQUE concerns from the bullet are
--     already solved (FIX-101 dropped the UNIQUE; tagger only queues PACs).
--   * An individual-only trigram for donor-by-name lookup — no call site
--     wants it today; revisit when FIX-194 (c) "pin a donor" lands.

BEGIN;

DROP INDEX IF EXISTS public.financial_entities_display_trgm;
CREATE INDEX financial_entities_display_trgm
  ON public.financial_entities
  USING GIN (display_name gin_trgm_ops)
  WHERE entity_type <> 'individual';

DROP INDEX IF EXISTS public.financial_entities_canonical;
CREATE INDEX financial_entities_canonical
  ON public.financial_entities (canonical_name)
  WHERE entity_type <> 'individual';

DROP INDEX IF EXISTS public.financial_entities_canonical_name_type;
CREATE INDEX financial_entities_canonical_name_type
  ON public.financial_entities (canonical_name, entity_type)
  WHERE entity_type <> 'individual';

COMMENT ON INDEX public.financial_entities_display_trgm IS
  'Trigram name search over PAC/corp/union/etc. — excludes individuals (FIX-195). Callers that need to search individual donors by name should use a separate predicate or add a dedicated index (FIX-194 territory).';
COMMENT ON INDEX public.financial_entities_canonical IS
  'Canonical-name lookup over non-individual entities (FIX-195). Individuals dedup on donor_fingerprint, not canonical_name.';
COMMENT ON INDEX public.financial_entities_canonical_name_type IS
  'Composite (canonical_name, entity_type) lookup over non-individual entities (FIX-195).';

COMMIT;

-- DOWN:
--   BEGIN;
--   DROP INDEX IF EXISTS public.financial_entities_display_trgm;
--   CREATE INDEX financial_entities_display_trgm
--     ON public.financial_entities USING GIN (display_name gin_trgm_ops);
--   DROP INDEX IF EXISTS public.financial_entities_canonical;
--   CREATE INDEX financial_entities_canonical
--     ON public.financial_entities (canonical_name);
--   DROP INDEX IF EXISTS public.financial_entities_canonical_name_type;
--   CREATE INDEX financial_entities_canonical_name_type
--     ON public.financial_entities (canonical_name, entity_type);
--   COMMIT;

-- ─── Fix: civic_initiatives draft privacy ────────────────────────────────────
-- The original select_all policy used USING (true), exposing every draft to
-- anyone with the URL (or the list page). Drafts must be private — only the
-- primary_author_id may read them.
--
-- New rule: non-draft rows are public; draft rows visible to author only.
--   stage != 'draft'               → all roles may read
--   primary_author_id = auth.uid() → authenticated author may read their draft
-- Anonymous sessions: auth.uid() returns NULL → NULL = author_id evaluates to
-- NULL (not TRUE), so drafts remain hidden.

DROP POLICY IF EXISTS "civic_initiatives_select_all" ON civic_initiatives;

CREATE POLICY "civic_initiatives_select_public_or_own_draft" ON civic_initiatives
  FOR SELECT TO anon, authenticated
  USING (
    stage != 'draft'
    OR primary_author_id = auth.uid()
  );

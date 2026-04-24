-- Extend ai_summary_cache SELECT to the authenticated role.
--
-- The original policy in 0005_ai_summary_cache.sql granted SELECT TO anon
-- only. Signed-in users hit authenticated, not anon, so the server-side
-- cache read on officials/[id] and proposals/[id] page.tsx (which uses
-- createServerClient) returned null for them and the client-side
-- AiProfileSection had to fall through to /api/.../summary to get the
-- cached value. This preserves the anon policy and adds authenticated.
CREATE POLICY "ai_summary_cache_authenticated_read"
  ON ai_summary_cache FOR SELECT TO authenticated USING (true);

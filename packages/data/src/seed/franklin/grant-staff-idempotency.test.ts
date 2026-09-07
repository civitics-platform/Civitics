/**
 * FIX-928 — grantStaff() is idempotent, and the index is what makes it so.
 *
 * Runs via:  tsx --test src/seed/franklin/grant-staff-idempotency.test.ts
 *
 * THE BUG THIS PINS. grantStaff() (lib.ts) has always carried
 *
 *   ON CONFLICT (user_id, role, target_type, target_id) WHERE status = 'active'
 *     DO NOTHING
 *
 * which reads as idempotent and was not, because it inserts a GLOBAL grant and
 * entity_grants_target_shape forces target_id IS NULL for target_type='global'.
 * A plain B-tree unique index treats every NULL as distinct from every other
 * NULL, so the arbiter could never match its own prior row and every call
 * inserted. Thirteen active staff/global grants accumulated for one account
 * across six seed runs before anyone counted them.
 *
 * The migration 20260908000100 rebuilt the index with NULLS NOT DISTINCT. The
 * seed statement is UNCHANGED — the fix is underneath it. That is exactly the
 * kind of repair that decays silently, because nothing in the seed's own source
 * records that it depends on an index property, so both halves are asserted
 * here: the statement's shape (always) and the behaviour (whenever a database
 * is reachable).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

// ---------------------------------------------------------------------------
// Source anchor — runs everywhere, including CI with no database.
// ---------------------------------------------------------------------------

test("grantStaff still arbitrates on the full four-column key", () => {
  const src = fs.readFileSync(path.join(__dirname, "lib.ts"), "utf8");
  const m = src.match(/export async function grantStaff[\s\S]*?\n}/);
  assert.ok(m, "grantStaff() not found in lib.ts");
  const body = m[0];

  assert.match(
    body,
    /ON CONFLICT \(user_id, role, target_type, target_id\)\s+WHERE status = 'active'\s+DO NOTHING/,
    "the arbiter must stay the full four-column key matching entity_grants_unique_active",
  );
  assert.match(body, /'global', NULL/, "this is the NULL-target path the index has to see");
});

test("no entity_grants writer arbitrates on a narrower key than the index", () => {
  // A second writer with a three-column arbiter would not match the index and
  // would fall back to inserting — the same failure in a new place.
  const seedDir = __dirname;
  for (const f of ["lib.ts", "index.ts"]) {
    const src = fs.readFileSync(path.join(seedDir, f), "utf8");
    for (const m of src.matchAll(/INSERT INTO public\.entity_grants[\s\S]{0,400}?ON CONFLICT \(([^)]*)\)/g)) {
      assert.equal(
        m[1]!.replace(/\s+/g, " ").trim(),
        "user_id, role, target_type, target_id",
        `${f}: an entity_grants ON CONFLICT arbiter must be the full unique-index key`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Behavioural anchor — the two-call test. Skipped when no database is reachable.
// ---------------------------------------------------------------------------

const LOCAL_DB =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** The seed's statement, verbatim. Copied rather than imported so the test does
 *  not depend on SeedCtx wiring — the thing under test is the SQL. */
const GRANT_STAFF_SQL = `
INSERT INTO public.entity_grants (user_id, target_type, target_id, role, status, granted_at)
VALUES ($1, 'global', NULL, 'staff', 'active', $2)
ON CONFLICT (user_id, role, target_type, target_id) WHERE status = 'active' DO NOTHING`;

test("two grantStaff calls insert ONE active grant", async (t) => {
  const client = new Client({ connectionString: LOCAL_DB, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch {
    t.skip("no database reachable — behavioural half skipped (source anchors above still ran)");
    return;
  }

  try {
    // Everything inside one transaction that is always rolled back: this test
    // must leave no trace, least of all a live staff grant.
    await client.query("BEGIN");

    const {
      rows: [idx],
    } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'entity_grants_unique_active'`,
    );
    assert.ok(idx, "entity_grants_unique_active must exist");
    assert.match(
      idx.indexdef,
      /NULLS NOT DISTINCT/,
      "FIX-928: without NULLS NOT DISTINCT the arbiter cannot match a NULL target_id " +
        "and grantStaff silently re-inserts on every seed run",
    );

    const {
      rows: [u],
    } = await client.query<{ id: string }>(
      `WITH a AS (INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id)
       INSERT INTO public.users (id, display_name, is_synthetic, created_at, last_seen)
       SELECT id, 'fix928 idempotency probe', true, now(), now() FROM a
       RETURNING id`,
    );
    const userId = u!.id;

    await client.query(GRANT_STAFF_SQL, [userId, new Date().toISOString()]);
    await client.query(GRANT_STAFF_SQL, [userId, new Date().toISOString()]);

    const {
      rows: [c],
    } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.entity_grants
        WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    assert.equal(
      c!.n,
      "1",
      "two identical grantStaff calls must leave exactly one active grant — " +
        "this is the assertion that was false for six seed runs",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
});

test("revoke_grant() withdraws an active NULL-target grant", async (t) => {
  // The other half of FIX-928: before revoke_grant() there was no way to revoke
  // an active grant at all, and PostgREST cannot express the NULL-safe match a
  // global-scoped grant needs.
  const client = new Client({ connectionString: LOCAL_DB, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch {
    t.skip("no database reachable");
    return;
  }

  try {
    await client.query("BEGIN");
    const {
      rows: [u],
    } = await client.query<{ id: string }>(
      `WITH a AS (INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id)
       INSERT INTO public.users (id, display_name, is_synthetic, created_at, last_seen)
       SELECT id, 'fix928 revoke probe', true, now(), now() FROM a
       RETURNING id`,
    );
    const userId = u!.id;
    await client.query(GRANT_STAFF_SQL, [userId, new Date().toISOString()]);

    const {
      rows: [r],
    } = await client.query<{ n: number }>(
      `SELECT public.revoke_grant($1::uuid, 'staff'::grant_role, 'global'::grant_target_type,
                                  NULL::uuid, NULL::uuid, 'test') AS n`,
      [userId],
    );
    assert.equal(Number(r!.n), 1, "the active global grant must be revoked by KEY");

    const {
      rows: [after],
    } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.entity_grants
        WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    assert.equal(after!.n, "0", "no active grant may survive the revoke");

    const {
      rows: [ev],
    } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.grant_events e
        JOIN public.entity_grants g ON g.id = e.grant_id
       WHERE g.user_id = $1 AND e.event = 'revoked'`,
      [userId],
    );
    assert.equal(ev!.n, "1", "revocation must leave exactly one grant_events row");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
});

/**
 * FIX-914 — the guards on derive_nh_floterials().
 *
 * The function is what the TIGER pipeline calls after a district refresh, so it
 * runs unattended, a year apart, against whatever the base layer has become.
 * Three properties have to hold for that to be safe, and none of them is
 * checked anywhere else:
 *
 *   1. A MISSING BASE ROW RAISES. A floterial that resolves fewer base
 *      districts than its list names would still produce a perfectly valid
 *      polygon — a smaller, wrong one — and nothing downstream would notice a
 *      district quietly losing a town. Refusing the whole run is the only safe
 *      answer.
 *   2. A NO-OP RE-RUN WRITES NOTHING. Returning 39 every time would make the
 *      pipeline's own report useless as a change signal and churn 39 rows'
 *      updated_at for nothing.
 *   3. A CHANGED BASE GEOMETRY UPDATES IN PLACE. That is the whole reason the
 *      function exists, and it must reuse the row rather than mint a second
 *      Belknap 8 — the partial unique index is what guarantees it.
 *
 * Every case runs inside a transaction that is ROLLED BACK, so the suite leaves
 * the local database exactly as it found it. Skips when 127.0.0.1:54322 is
 * unreachable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function connectOrNull(): Promise<Client | null> {
  const client = new Client({
    connectionString: LOCAL_DB_URL,
    application_name: "civitics_derive_nh_floterials_test",
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

/** Run `fn` inside a transaction and always roll it back. */
async function inRollback(fn: (c: Client) => Promise<void>): Promise<boolean> {
  const client = await connectOrNull();
  if (!client) return false;
  try {
    await client.query("BEGIN");
    await fn(client);
    return true;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

const derive = async (c: Client): Promise<number> =>
  Number((await c.query<{ n: string }>("SELECT public.derive_nh_floterials()::text AS n")).rows[0]!.n);

test("a second call over unchanged base geometry writes nothing", async (t) => {
  const ran = await inRollback(async (c) => {
    // The migration already seeded these, so the first call here is itself the
    // no-op case; assert both to be explicit about which is which.
    assert.equal(await derive(c), 0, "the seeded state should already be current");
    assert.equal(await derive(c), 0, "and stay current");
  });
  if (!ran) t.skip("local Postgres unreachable");
});

test("a changed base geometry re-unions the floterial IN PLACE, same row id", async (t) => {
  const ran = await inRollback(async (c) => {
    const before = (await c.query<{ id: string; area: string }>(
      `SELECT id, ST_Area(boundary_geometry)::text AS area
         FROM public.jurisdictions
        WHERE type='district' AND metadata->>'source'='derived'
          AND metadata->>'district_id'='008'`)).rows[0]!;

    // Shrink base district 003 (Sanbornton + Tilton), one of Belknap 8's two.
    await c.query(
      `UPDATE public.jurisdictions
          SET boundary_geometry = ST_Multi(ST_Buffer(boundary_geometry, -0.01))
        WHERE type='district' AND metadata->>'state_abbr'='NH'
          AND metadata->>'chamber'='lower' AND metadata->>'district_id'='003'`);

    assert.equal(await derive(c), 1, "exactly the one affected floterial should be rewritten");

    const after = (await c.query<{ id: string; area: string; n: string }>(
      `SELECT id, ST_Area(boundary_geometry)::text AS area,
              (SELECT count(*)::text FROM public.jurisdictions
                WHERE type='district' AND metadata->>'source'='derived'
                  AND metadata->>'district_id'='008') AS n
         FROM public.jurisdictions
        WHERE type='district' AND metadata->>'source'='derived'
          AND metadata->>'district_id'='008'`)).rows[0]!;

    assert.equal(after.n, "1", "the unique index must prevent a second Belknap 8");
    assert.equal(after.id, before.id, "the row is updated in place, not replaced");
    assert.ok(Number(after.area) < Number(before.area), "the union should have shrunk with its base");

    // And it settles: a further call over the now-consistent state is a no-op.
    assert.equal(await derive(c), 0);
  });
  if (!ran) t.skip("local Postgres unreachable");
});

test("a missing base row raises and names the floterial — never a partial union", async (t) => {
  const ran = await inRollback(async (c) => {
    // Take base district 004 (Belmont) out of reach of the resolver without
    // deleting it: Belknap 8 names 003 and 004, so it can now resolve only one.
    await c.query(
      `UPDATE public.jurisdictions
          SET metadata = metadata || jsonb_build_object('district_id','004-gone')
        WHERE type='district' AND metadata->>'state_abbr'='NH'
          AND metadata->>'chamber'='lower' AND metadata->>'district_id'='004'`);

    await assert.rejects(
      () => derive(c),
      (err: Error) => {
        assert.match(err.message, /base districts missing/i);
        assert.match(err.message, /008/, "the message should name the floterial that broke");
        assert.match(err.message, /wanted 2, resolved 1/, "and say how badly");
        return true;
      },
    );
  });
  if (!ran) t.skip("local Postgres unreachable");
});

test("a base row with no geometry counts as missing, not as an empty union", async (t) => {
  const ran = await inRollback(async (c) => {
    // A NULL boundary would make ST_Union silently skip it and produce a valid
    // polygon covering one town too few — the exact failure the guard exists for.
    await c.query(
      `UPDATE public.jurisdictions SET boundary_geometry = NULL
        WHERE type='district' AND metadata->>'state_abbr'='NH'
          AND metadata->>'chamber'='lower' AND metadata->>'district_id'='004'`);
    await assert.rejects(() => derive(c), /base districts missing/i);
  });
  if (!ran) t.skip("local Postgres unreachable");
});

test("derive_nh_floterials is not executable by anon or authenticated", async (t) => {
  const client = await connectOrNull();
  if (!client) { t.skip("local Postgres unreachable"); return; }
  try {
    const { rows } = await client.query<{ role: string; ok: boolean }>(
      `SELECT r AS role,
              has_function_privilege(r, 'public.derive_nh_floterials()', 'EXECUTE') AS ok
         FROM unnest(ARRAY['anon','authenticated','service_role']) AS r`);
    const by = Object.fromEntries(rows.map((r) => [r.role, r.ok]));
    assert.equal(by.anon, false);
    assert.equal(by.authenticated, false);
    assert.equal(by.service_role, true, "the pipelines call it as service_role");
  } finally { await client.end().catch(() => {}); }
});

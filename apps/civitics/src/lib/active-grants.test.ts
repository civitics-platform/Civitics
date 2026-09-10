/**
 * FIX-1167 — the /admin/grants active-grants shaping.
 *
 * Runs via:  tsx --test src/lib/active-grants.test.ts
 *
 * The case that matters most is the global grant: entity_grants_target_shape
 * forces target_id IS NULL for target_type='global', so any resolution that
 * treats "no target row" as "drop the grant" loses exactly the platform_admin
 * and staff grants an operator most needs to revoke. Every other assertion here
 * exists so that one cannot regress quietly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ActiveGrantRow,
  type TargetMaps,
  buildActiveGrants,
  grantKey,
  identityLabel,
  resolveTargetHref,
  resolveTargetLabel,
  revokeConfirmMessage,
  revokeResultMessage,
} from "./active-grants";

const OFFICIAL_ID = "11111111-1111-4111-8111-111111111111";
const JURIS_ID = "22222222-2222-4222-8222-222222222222";
const INST_ID = "33333333-3333-4333-8333-333333333333";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const maps: TargetMaps = {
  officialById: new Map([[OFFICIAL_ID, "Jane Doe"]]),
  jurisdictionById: new Map([[JURIS_ID, "Franklin County"]]),
  institutionById: new Map([[INST_ID, "Acme Foundation"]]),
};

const users = new Map([
  [USER_A, { email: "a@example.com", display_name: "Ada" }],
  [USER_B, { email: null, display_name: null }],
]);

const row = (over: Partial<ActiveGrantRow> = {}): ActiveGrantRow => ({
  id: "g1",
  user_id: USER_A,
  role: "official",
  target_type: "official",
  target_id: OFFICIAL_ID,
  granted_at: "2026-08-01T00:00:00.000Z",
  expires_at: "2027-08-01T00:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const globalRow = (over: Partial<ActiveGrantRow> = {}): ActiveGrantRow =>
  row({ role: "platform_admin", target_type: "global", target_id: null, ...over });

// ---------------------------------------------------------------------------
// The NULL-target case
// ---------------------------------------------------------------------------

test("FIX-1167 a global grant survives resolution and is labelled, not dropped", () => {
  const out = buildActiveGrants([globalRow({ id: "g-global" })], users, maps);
  assert.equal(out.length, 1, "a NULL-target grant must never be filtered out");
  assert.equal(out[0]!.targetLabel, "global");
  assert.equal(out[0]!.targetId, null);
  assert.equal(out[0]!.targetHref, null, "global has no public page to link to");
});

test("FIX-1167 a mixed list keeps BOTH the global and the scoped grant", () => {
  // The regression this pins: an inner join on officials would return only g-scoped.
  const out = buildActiveGrants(
    [globalRow({ id: "g-global" }), row({ id: "g-scoped" })],
    users,
    maps,
  );
  assert.deepEqual(
    out.map((g) => g.id).sort(),
    ["g-global", "g-scoped"],
    "both must survive; losing the global one is the FIX-928 NULL-blindness again",
  );
  const byId = new Map(out.map((g) => [g.id, g]));
  assert.equal(byId.get("g-global")!.targetLabel, "global");
  assert.equal(byId.get("g-scoped")!.targetLabel, "Jane Doe");
});

test("FIX-1167 global sorts first — the broadest access is listed at the top", () => {
  const out = buildActiveGrants(
    [row({ id: "g-scoped" }), globalRow({ id: "g-global" })],
    users,
    maps,
  );
  assert.equal(out[0]!.id, "g-global");
});

test("FIX-1167 grantKey never lets a NULL target collide with a uuid", () => {
  const g = grantKey({ user_id: USER_A, role: "staff", target_type: "global", target_id: null });
  const s = grantKey({
    user_id: USER_A,
    role: "staff",
    target_type: "global",
    target_id: OFFICIAL_ID,
  });
  assert.notEqual(g, s);
  assert.ok(!g.endsWith("|"), "an empty segment would be ambiguous with a missing value");
});

// ---------------------------------------------------------------------------
// Target resolution across all four types
// ---------------------------------------------------------------------------

test("FIX-1167 each target type resolves to its own name, and its own href", () => {
  assert.equal(resolveTargetLabel("official", OFFICIAL_ID, maps), "Jane Doe");
  assert.equal(resolveTargetLabel("jurisdiction", JURIS_ID, maps), "Franklin County");
  assert.equal(resolveTargetLabel("institution", INST_ID, maps), "Acme Foundation");
  assert.equal(resolveTargetLabel("global", null, maps), "global");

  assert.equal(resolveTargetHref("official", OFFICIAL_ID), `/officials/${OFFICIAL_ID}`);
  assert.equal(resolveTargetHref("jurisdiction", JURIS_ID), `/jurisdictions/${JURIS_ID}`);
  assert.equal(resolveTargetHref("institution", INST_ID), `/institutions/${INST_ID}`);
  assert.equal(resolveTargetHref("global", null), null);
});

test("FIX-1167 an unresolvable target id degrades to a visible id, never to blank", () => {
  const label = resolveTargetLabel("official", "99999999-9999-4999-8999-999999999999", maps);
  assert.ok(label.startsWith("official 99999999"), label);
  // And a shape violation (non-global with a NULL target) is surfaced, not hidden.
  assert.equal(resolveTargetLabel("official", null, maps), "official (no target id)");
});

// ---------------------------------------------------------------------------
// The count that has to be shown before the click
// ---------------------------------------------------------------------------

test("FIX-1167 duplicate active rows on one key report the count on every row", () => {
  // The FIX-928 shape: several active global staff grants for one account.
  const dupes = [
    globalRow({ id: "d1", role: "staff" }),
    globalRow({ id: "d2", role: "staff" }),
    globalRow({ id: "d3", role: "staff" }),
  ];
  const out = buildActiveGrants(dupes, users, maps);
  assert.equal(out.length, 3);
  for (const g of out) {
    assert.equal(g.activeOnKey, 3, "one click retires all three — the operator must see that");
  }
});

test("FIX-1167 distinct keys do not share a count", () => {
  const out = buildActiveGrants(
    [globalRow({ id: "x", role: "staff" }), globalRow({ id: "y", role: "staff", user_id: USER_B })],
    users,
    maps,
  );
  assert.deepEqual(
    out.map((g) => g.activeOnKey),
    [1, 1],
  );
});

test("FIX-1167 the confirmation names the count, the identity and the scope", () => {
  const [g] = buildActiveGrants([globalRow({ role: "staff" })], users, maps);
  assert.equal(
    revokeConfirmMessage(g!, g!.activeOnKey),
    "Revoke 1 active grant for a@example.com · staff · global?",
  );
  assert.equal(
    revokeConfirmMessage(g!, 13),
    "Revoke 13 active grants for a@example.com · staff · global?",
  );
});

test("FIX-1167 a user with no email or name still gets a stable identity label", () => {
  const [g] = buildActiveGrants([row({ user_id: USER_B })], users, maps);
  assert.equal(identityLabel(g!), `user ${USER_B.slice(0, 8)}…`);
  // And an id absent from the users map at all.
  assert.equal(
    identityLabel({ userEmail: null, userName: null, userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    "user cccccccc…",
  );
});

test("FIX-1167 a count mismatch is shown, not smoothed over", () => {
  assert.equal(revokeResultMessage(1, 1), "Revoked 1 grant.");
  assert.equal(revokeResultMessage(3, 3), "Revoked 3 grants.");
  const mismatch = revokeResultMessage(3, 1);
  assert.ok(mismatch.includes("Revoked 1 grant"), mismatch);
  assert.ok(mismatch.includes("3 were active"), mismatch);
  assert.ok(mismatch.includes("must match"), mismatch);
});

test("FIX-1167 an empty list shapes to an empty list rather than throwing", () => {
  assert.deepEqual(buildActiveGrants([], users, maps), []);
});

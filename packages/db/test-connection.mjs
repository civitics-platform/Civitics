/**
 * Quick Supabase connection test.
 * Verifies both the publishable-key client and the secret-key admin client
 * can reach the database.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local packages/db/test-connection.mjs
 *
 * Expects these env vars to be set:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_SECRET_KEY
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

function assertEnv(name, value) {
  if (!value) {
    console.error(`❌  Missing env var: ${name}`);
    process.exit(1);
  }
}

assertEnv("NEXT_PUBLIC_SUPABASE_URL", url);
assertEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);
assertEnv("SUPABASE_SECRET_KEY", secretKey);

async function testClient(label, client) {
  // Query a system view that always exists — returns row count (could be 0).
  // A successful round-trip (even with no tables yet) proves connectivity.
  const { error } = await client
    .from("jurisdictions")
    .select("id", { count: "exact", head: true });

  // PGRST116 = "no rows" (table exists but empty) — fine.
  // 42P01 = table does not exist — also fine, proves DB is reachable.
  // Any network/auth error is a real failure.
  if (error && error.code !== "42P01" && error.code !== "PGRST116") {
    console.error(`❌  [${label}] ${error.code ?? "ERROR"}: ${error.message}`);
    return false;
  }

  const status = error?.code === "42P01" ? "DB reachable (table not yet created)" : "DB reachable";
  console.log(`✅  [${label}] ${status}`);
  return true;
}

console.log("\n── Civitics Supabase Connection Test ──\n");
console.log(`   URL: ${url}\n`);

const browserClient = createClient(url, publishableKey);
const adminClient = createClient(url, secretKey, {
  auth: { persistSession: false },
});

const results = await Promise.all([
  testClient("publishable / browser", browserClient),
  testClient("secret / admin     ", adminClient),
]);

console.log();
if (results.every(Boolean)) {
  console.log("All connections OK.\n");
} else {
  console.log("One or more connections failed.\n");
  process.exit(1);
}

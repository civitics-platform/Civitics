#!/usr/bin/env node
// scripts/fixes-sync.mjs
//
// One-way sync between git commit trailers and FIXES.md status.
//
//   1. Scans `git log` for commits whose body contains `Fixes: FIX-NNN[, FIX-MMM]`.
//   2. Appends any new (FIX-ID, commit-sha) pairs to docs/done.log.
//      Append-only — existing lines are never rewritten.
//   3. Reads docs/done.log and flips `- [ ]` to `- [x]` for any bullet in FIXES.md
//      whose trailing `<!--id:FIX-NNN-->` marker appears in the log.
//
//   The script NEVER un-checks a bullet. Reopens are a manual operation:
//   hand-uncheck in FIXES.md and add a `reopen` note in done.log.
//
// Usage:
//   node scripts/fixes-sync.mjs            sync + rewrite FIXES.md
//   node scripts/fixes-sync.mjs --dry-run  show what would change, write nothing
//   node scripts/fixes-sync.mjs --check    exit 1 if anything is out of sync (CI)

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel").toString().trim();
const FIXES_PATH = resolve(REPO_ROOT, "docs/FIXES.md");
const DONE_PATH = resolve(REPO_ROOT, "docs/done.log");

const DRY = process.argv.includes("--dry-run");
const CHECK = process.argv.includes("--check");

function readDoneLog() {
  if (!existsSync(DONE_PATH)) {
    return { entries: [], keys: new Set(), completedIds: new Set(), reopenedIds: new Set() };
  }
  const text = readFileSync(DONE_PATH, "utf8");
  const entries = [];
  const keys = new Set();
  const completedIds = new Set();
  const reopenedIds = new Set();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) continue;
    const [date, id, sha, ...noteParts] = parts;
    const entry = { date, id, sha, note: noteParts.join(" | ") };
    entries.push(entry);
    keys.add(`${id}|${sha}`);
    if (sha === "reopen") {
      reopenedIds.add(id);
      completedIds.delete(id);
    } else {
      if (!reopenedIds.has(id)) completedIds.add(id);
    }
  }
  return { entries, keys, completedIds, reopenedIds };
}

function scanCommits() {
  // Delimiters: %x00 separates fields within a commit, %x1e between commits.
  const raw = execSync(
    'git log --all --pretty=format:"%H%x00%ad%x00%s%x00%b%x1e" --date=short',
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const blocks = raw.split("\x1e").map((b) => b.trim()).filter(Boolean);
  const trailerRe = /^\s*Fixes:\s*(.+)$/im;
  const idRe = /FIX-\d{3}/g;
  const completions = [];
  for (const block of blocks) {
    const [sha = "", date = "", subject = "", body = ""] = block.split("\x00");
    const m = body.match(trailerRe);
    if (!m) continue;
    const ids = [...new Set(m[1].match(idRe) || [])];
    for (const id of ids) {
      completions.push({
        id,
        sha: sha.trim().slice(0, 8),
        date: date.trim(),
        note: subject.trim(),
      });
    }
  }
  return completions;
}

function appendNewEntries(existing, completions) {
  const seen = existing.keys;
  const newOnes = completions.filter((c) => !seen.has(`${c.id}|${c.sha}`));
  if (newOnes.length === 0) return [];
  // Stable sort: date ascending, then id.
  newOnes.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lines = newOnes.map((c) => `${c.date} | ${c.id} | ${c.sha} | ${c.note}`);
  if (!DRY && !CHECK) appendFileSync(DONE_PATH, lines.join("\n") + "\n");
  return newOnes;
}

function syncFixesMd(completedIds) {
  const content = readFileSync(FIXES_PATH, "utf8");
  const lines = content.split("\n");
  const flipped = [];
  const missingMarker = [];

  const bulletRe = /^(\s*- \[)([ xX])(\] .+)$/;
  const idRe = /<!--\s*id:\s*(FIX-\d{3})\s*-->/;
  const archiveHeadingRe = /^##\s+COMPLETED\b/i;

  let inArchive = false;
  const out = lines.map((line) => {
    if (archiveHeadingRe.test(line)) inArchive = true;
    const m = line.match(bulletRe);
    if (!m) return line;
    const [, pre, box, rest] = m;
    const idMatch = rest.match(idRe);
    if (!idMatch) {
      if (!inArchive) missingMarker.push(line.slice(0, 80));
      return line;
    }
    const id = idMatch[1];
    const isChecked = box.toLowerCase() === "x";
    const shouldBeChecked = completedIds.has(id);
    if (shouldBeChecked && !isChecked) {
      flipped.push(id);
      return `${pre}x${rest}`;
    }
    return line;
  });

  if (flipped.length > 0 && !DRY && !CHECK) {
    writeFileSync(FIXES_PATH, out.join("\n"));
  }
  return { flipped, missingMarker };
}

// ── main ─────────────────────────────────────────────────────────────
const done = readDoneLog();
const trailerCompletions = scanCommits();
const newEntries = appendNewEntries(done, trailerCompletions);
const allCompleted = new Set(done.completedIds);
for (const c of newEntries) if (!done.reopenedIds.has(c.id)) allCompleted.add(c.id);
const { flipped, missingMarker } = syncFixesMd(allCompleted);

const summary = {
  trailersScanned: trailerCompletions.length,
  newLoggedEntries: newEntries.length,
  checkboxesFlipped: flipped.length,
  bulletsMissingIdMarker: missingMarker.length,
};

console.log("fixes:sync —", DRY ? "DRY RUN" : CHECK ? "CHECK MODE" : "APPLIED");
console.table(summary);
if (newEntries.length) {
  console.log("\nNew done.log entries:");
  for (const e of newEntries) console.log(`  ${e.date} | ${e.id} | ${e.sha} | ${e.note}`);
}
if (flipped.length) {
  console.log("\nCheckboxes flipped to [x]:");
  for (const id of flipped) console.log(`  ${id}`);
}
if (missingMarker.length && !CHECK) {
  console.log(`\n${missingMarker.length} bullet(s) without <!--id:FIX-NNN--> marker (first 5):`);
  for (const snip of missingMarker.slice(0, 5)) console.log(`  ${snip}…`);
}

if (CHECK && (newEntries.length > 0 || flipped.length > 0)) {
  console.error("\nFIXES.md is out of sync with commit trailers. Run `pnpm fixes:sync`.");
  process.exit(1);
}

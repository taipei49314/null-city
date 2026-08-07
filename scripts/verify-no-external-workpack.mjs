#!/usr/bin/env node
/**
 * Rejects source/test file reads or imports that depend on `_audit/` or other
 * excluded kickoff unpack paths. Fresh checkouts and release archives must be
 * self-contained (M10.1.1 P0-A / NC-M10.1-001).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();

/** Path-like references that must not appear in shipped source/tests. */
const FORBIDDEN = [
  /_audit\//,
  /recovery_candidates\//,
  /nullcity-m\d[\w.-]*-pack\//i,
];

const SCAN_ROOTS = ["apps", "packages", "scripts"];
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
/** Scripts that enforce the exclusion may mention the forbidden token. */
const ALLOWLIST = new Set([
  "scripts/verify-no-external-workpack.mjs",
  "scripts/verify-markdown-links.mjs",
  "scripts/verify-release-archive.mjs",
]);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && TEXT_EXT.test(entry.name)) {
      out.push(full);
    }
  }
}

function listFiles() {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!tracked.error && tracked.status === 0 && tracked.stdout.length > 0) {
    return tracked.stdout
      .split("\0")
      .filter(Boolean)
      .filter((rel) => SCAN_ROOTS.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`)))
      .filter((rel) => TEXT_EXT.test(rel));
  }
  const out = [];
  for (const prefix of SCAN_ROOTS) {
    walk(join(root, prefix), out);
  }
  return out.map((abs) => relative(root, abs).split(sep).join("/"));
}

const offenders = [];
for (const rel of listFiles()) {
  if (ALLOWLIST.has(rel)) continue;
  const text = readFileSync(join(root, rel), "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FORBIDDEN.some((re) => re.test(line))) {
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
}

if (offenders.length > 0) {
  process.stderr.write(`FAIL no-external-workpack: ${offenders.length} reference(s) to excluded paths\n`);
  for (const line of offenders.slice(0, 40)) {
    process.stderr.write(`  ${line}\n`);
  }
  process.exit(1);
}

process.stdout.write(`PASS no-external-workpack: scanned apps/packages/scripts, 0 excluded-path references\n`);

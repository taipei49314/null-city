#!/usr/bin/env node
/**
 * `pnpm verify:release-archive` — proves the release archive cannot ship
 * secrets or build output.
 *
 * Audit finding P1-02 was reproduced by dropping a `.env` into the working
 * tree and finding it inside `null-city-v0.1.0.tar.gz`. This check plants that
 * exact canary (plus a stray log and a fake private key), builds a real
 * archive, lists the tarball with `tar -tzf`, and fails if any canary — or any
 * `node_modules/`, `dist/`, or `.tsbuildinfo` path — is present.
 *
 * The canaries are written into the working tree and removed again in a
 * `finally`, so an interrupted run leaves no `.env` behind that a later
 * archive could pick up.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectReleaseFiles } from "./lib/release-files.mjs";

const root = process.cwd();

function fail(message) {
  process.stderr.write(`FAIL release-archive-canary: ${message}\n`);
  process.exit(1);
}

const CANARIES = [
  { path: ".env", body: "NULLCITY_CANARY_SECRET=must-never-be-archived\n" },
  { path: ".env.local", body: "NULLCITY_CANARY_SECRET=must-never-be-archived\n" },
  { path: "packages/server/.env", body: "NULLCITY_CANARY_SECRET=must-never-be-archived\n" },
  { path: "scripts/nullcity-canary.log", body: "canary log line\n" },
  { path: "packages/contracts/canary-private.pem", body: "-----BEGIN PRIVATE KEY-----\ncanary\n" },
];

const planted = [];

function plant() {
  for (const canary of CANARIES) {
    const absolute = join(root, canary.path);
    if (existsSync(absolute)) {
      // Never clobber a real developer file; the remaining canaries still
      // exercise the same rules.
      continue;
    }
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, canary.body, "utf8");
    planted.push(absolute);
  }
  if (planted.length === 0) {
    fail("no canary could be planted; cannot prove exclusion");
  }
}

function cleanup() {
  for (const absolute of planted) {
    rmSync(absolute, { force: true });
  }
}

const FORBIDDEN_SUBSTRINGS = [
  "/.env",
  "node_modules/",
  "/dist/",
  ".tsbuildinfo",
  "nullcity-canary.log",
  "canary-private.pem",
];

function isForbidden(entry) {
  const normalized = entry.startsWith("./") ? entry.slice(1) : `/${entry}`;
  if (normalized.endsWith("/")) {
    return false;
  }
  return FORBIDDEN_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

try {
  plant();

  // 1. Selection layer: the canaries must not even be candidates.
  const { files, excluded, source } = collectReleaseFiles(root);
  const selectedCanaries = files.filter((file) => CANARIES.some((c) => c.path === file));
  if (selectedCanaries.length > 0) {
    fail(`file selection (${source}) included canary path(s): ${selectedCanaries.join(", ")}`);
  }

  // 2. Archive layer: build a real tarball and read back what is inside it.
  const build = spawnSync(process.execPath, [join("scripts", "release-archive.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    fail(`release-archive.mjs exited ${build.status}\n${build.stdout ?? ""}\n${build.stderr ?? ""}`);
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const archivePath = join(root, "data", "release", `null-city-v${pkg.version ?? "0.0.0"}.tar.gz`);
  if (!existsSync(archivePath)) {
    fail(`expected archive at ${archivePath}`);
  }

  const list = spawnSync("tar", ["-tzf", archivePath], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (list.status !== 0) {
    fail(`tar -tzf exited ${list.status}: ${list.stderr ?? ""}`);
  }
  const entries = list.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (entries.length === 0) {
    fail("archive is empty");
  }
  const violations = entries.filter(isForbidden);
  if (violations.length > 0) {
    fail(`archive contains forbidden path(s):\n  ${violations.slice(0, 20).join("\n  ")}`);
  }
  if (!entries.some((entry) => entry.replace(/^\.\//, "") === "package.json")) {
    fail("archive is missing package.json, so the exclusion result is not meaningful");
  }

  // M10.1.1 P0-A: browser verifier tests and fixtures must ship together.
  const normalized = entries.map((entry) => entry.replace(/^\.\//, ""));
  const requiredPairs = [
    "apps/command-center/test/replay-verify-m10.1.test.ts",
    "apps/command-center/test/replay-verify-m10.1.1.test.ts",
    "apps/command-center/test/fixtures/minimal-semantic-forgery.artifact.json",
    "apps/command-center/test/fixtures/sample-run.artifact.json",
  ];
  for (const required of requiredPairs) {
    if (!normalized.includes(required) && !files.includes(required)) {
      fail(`release archive / selection missing required self-contained test asset: ${required}`);
    }
  }
  if (normalized.some((entry) => entry.startsWith("_audit/")) || files.some((file) => file.startsWith("_audit/"))) {
    fail("release selection must not include _audit/");
  }

  process.stdout.write(
    `PASS release-archive-canary: ${planted.length} canary file(s) planted, ` +
      `${entries.length} archive entries checked, ${excluded.length} candidate(s) denied by policy ` +
      `(selection source: ${source})\n`,
  );
} finally {
  cleanup();
}

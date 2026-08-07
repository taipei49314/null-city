#!/usr/bin/env node
/**
 * `pnpm release:archive` — builds a source release archive
 * (`data/release/null-city-v<version>.tar.gz`), a SHA-256 checksum file, and a
 * plain-text manifest of everything inside it, so a reviewer downloading a
 * GitHub release asset can verify it was not corrupted or tampered with in
 * transit and can see exactly what it contains.
 *
 * Contents are chosen by an allowlist (`scripts/lib/release-files.mjs`), not by
 * tarring the working tree and hoping the exclude flags cover everything.
 * Audit finding P1-02: the inherited script archived `.` with a handful of
 * `--exclude` patterns, so a local `.env`, stray logs, or any other untracked
 * file in the working tree was shipped inside the release asset.
 *
 * `--check` selects the file list, verifies the deny rules hold, and exits
 * without writing anything. `pnpm verify:release-archive` runs that mode plus
 * a live `.env` canary.
 *
 * This is a tamper-evidence checksum only: it proves the downloaded bytes
 * match what this script produced, not who produced them (see
 * docs/threat-model.md).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { collectReleaseFiles, isDenied } from "./lib/release-files.mjs";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

function fail(message) {
  process.stderr.write(`FAIL release-archive: ${message}\n`);
  process.exit(1);
}

const pkgPath = join(root, "package.json");
if (!existsSync(pkgPath)) {
  fail("package.json not found; run from the repository root");
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version ?? "0.0.0";

const { source, files, excluded } = collectReleaseFiles(root);
if (files.length === 0) {
  fail("file selection produced an empty archive");
}
// Belt and braces: the deny rules already ran during selection, but a bug that
// bypassed them must not be able to ship a secret.
const leaked = files.filter((file) => isDenied(file));
if (leaked.length > 0) {
  fail(`selection returned denied path(s): ${leaked.join(", ")}`);
}
for (const required of ["package.json", "README.md", "LICENSE"]) {
  if (!files.includes(required)) {
    fail(`file selection is missing required entry ${required}`);
  }
}

const manifest = `${files.join("\n")}\n`;

if (checkOnly) {
  process.stdout.write(
    `release-archive --check: ${files.length} file(s) selected via ${source}; ` +
      `${excluded.length} candidate(s) denied\n`,
  );
  process.stdout.write("PASS release-archive --check\n");
  process.exit(0);
}

const outDir = join(root, "data", "release");
mkdirSync(outDir, { recursive: true });

const archiveName = `null-city-v${version}.tar.gz`;
const archivePath = join(outDir, archiveName);

// `tar -T` reads the exact file list; nothing else in the tree can be swept in.
const listPath = join(tmpdir(), `null-city-release-files-${process.pid}.txt`);
writeFileSync(listPath, manifest, "utf8");
try {
  const result = spawnSync("tar", ["-czf", archivePath, "-T", listPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`tar failed (exit ${result.status}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
} finally {
  rmSync(listPath, { force: true });
}
if (!existsSync(archivePath)) {
  fail(`expected archive at ${archivePath} after tar`);
}

const buffer = readFileSync(archivePath);
const sha256 = createHash("sha256").update(buffer).digest("hex");
const checksumPath = `${archivePath}.sha256`;
writeFileSync(checksumPath, `${sha256}  ${archiveName}\n`);
const manifestPath = `${archivePath}.manifest.txt`;
writeFileSync(manifestPath, manifest, "utf8");

process.stdout.write(
  `selected ${files.length} file(s) via ${source} (${excluded.length} denied)\n` +
    `wrote ${archivePath} (${buffer.length} bytes)\nwrote ${checksumPath}\nwrote ${manifestPath}\nsha256=${sha256}\n`,
);
process.stdout.write("PASS release-archive\n");

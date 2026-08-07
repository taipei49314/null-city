/**
 * Release-hygiene audit for the M8 gate (section G, plus the "no secret
 * leakage" row of section D).
 *
 * This is a reviewer tool, not a test: it prints what it found and exits
 * non-zero only when it finds something that would falsify a stated release
 * claim. It deliberately walks the working tree rather than `git ls-files`,
 * because the release candidate must be clean as a *directory*, not merely as
 * a commit.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage"]);

/** Files that are legitimate repository content despite matching a risky glob. */
const ALLOWED = [
  // Screenshots referenced by the README.
  /^data[\\/]evidence[\\/].*\.png$/,
];

const STRAY_PATTERNS = [
  { label: "archive", re: /\.(tar\.gz|tgz|zip|7z|rar)$/i },
  { label: "local log", re: /\.log$/i },
  { label: "env file", re: /(^|[\\/])\.env(\.|$)/i },
  { label: "private key", re: /\.(pem|key|p12|pfx|jks)$/i },
  { label: "editor/OS cruft", re: /(^|[\\/])(\.DS_Store|Thumbs\.db|.*\.swp|.*~)$/i },
  { label: "temp snapshot", re: /(^|[\\/]).*\.(tmp|temp|bak|orig|rej)$/i },
];

const SECRET_PATTERNS = [
  { label: "assigned credential", re: /(api[_-]?key|secret|passwd|password|token|bearer)\s*[:=]\s*["'][A-Za-z0-9_\-./+]{16,}["']/i },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "OpenAI-style key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
];

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".css", ".html", ".cff", ".txt", ".sh",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Minimal .gitignore matcher covering the pattern forms this repository
 * actually uses (`dir/`, `*.ext`, `path/*.ext`, `name`). It exists so the
 * "repository clean" gate can distinguish a file that would ship in a clone
 * from a local build output that would not — a distinction a plain directory
 * walk cannot make. Anything more exotic than these forms would need real
 * gitignore semantics, so unknown forms are treated as "not ignored" (the
 * conservative direction: it over-reports rather than hiding a stray file).
 */
function buildIgnoreMatcher() {
  const raw = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  const rules = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const toRegExp = (pattern) => {
    const dirOnly = pattern.endsWith("/");
    const body = dirOnly ? pattern.slice(0, -1) : pattern;
    const escaped = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    // A pattern without a slash matches at any depth; one with a slash is
    // anchored to the repository root, matching git's own rule.
    const anchored = body.includes("/") ? `^${escaped}` : `(^|/)${escaped}`;
    return new RegExp(dirOnly ? `${anchored}(/|$)` : `${anchored}(/|$)`);
  };
  const regexes = rules.map(toRegExp);
  return (path) => {
    const posix = path.split(sep).join("/");
    return regexes.some((re) => re.test(posix));
  };
}

const isIgnored = buildIgnoreMatcher();

const files = walk(REPO_ROOT);
const rel = (file) => relative(REPO_ROOT, file);

const strays = [];
const localOnly = [];
for (const file of files) {
  const path = rel(file);
  if (ALLOWED.some((re) => re.test(path))) continue;
  for (const { label, re } of STRAY_PATTERNS) {
    if (re.test(path)) {
      const record = { label, path, bytes: statSync(file).size };
      // Ignored files are absent from a fresh clone, so they cannot violate
      // the "repository clean" claim — but they are still worth listing,
      // because evidence written to an ignored path would silently not ship.
      (isIgnored(path) ? localOnly : strays).push(record);
      break;
    }
  }
}

const secrets = [];
for (const file of files) {
  const path = rel(file);
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot);
  if (!TEXT_EXT.has(ext)) continue;
  if (path === join("pnpm-lock.yaml")) continue;
  // This file necessarily contains the detector patterns themselves.
  if (path === join("scripts", "adversarial", "audit-hygiene.mjs")) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { label, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        secrets.push({ label, path, line: index + 1, text: line.trim().slice(0, 120) });
      }
    }
  });
}

// CITATION.cff structural check. A full CFF validator is a Python tool and is
// not a dependency here, so this asserts only the required-field subset the
// 1.2.0 schema mandates, and reports the limitation honestly.
const citationPath = join(REPO_ROOT, "CITATION.cff");
const citation = readFileSync(citationPath, "utf8");
const requiredCff = ["cff-version:", "message:", "title:", "authors:"];
const missingCff = requiredCff.filter((key) => !citation.split(/\r?\n/).some((line) => line.startsWith(key)));

process.stdout.write("== release hygiene audit ==\n\n");
process.stdout.write(`scanned ${files.length} files (excluding ${[...SKIP_DIRS].join(", ")})\n\n`);

process.stdout.write(`stray artifacts that would ship in a clone: ${strays.length}\n`);
for (const item of strays) {
  process.stdout.write(`  [${item.label}] ${item.path} (${item.bytes} bytes)\n`);
}

process.stdout.write(`\ngitignored local-only artifacts (absent from a fresh clone): ${localOnly.length}\n`);
for (const item of localOnly) {
  process.stdout.write(`  [${item.label}] ${item.path} (${item.bytes} bytes)\n`);
}

process.stdout.write(`\npotential secrets: ${secrets.length}\n`);
for (const item of secrets) {
  process.stdout.write(`  [${item.label}] ${item.path}:${item.line} ${item.text}\n`);
}

process.stdout.write(`\nCITATION.cff required fields missing: ${missingCff.length ? missingCff.join(", ") : "none"}\n`);
process.stdout.write("  (subset check only — not a full CFF 1.2.0 schema validation)\n");

const failed = strays.length > 0 || secrets.length > 0 || missingCff.length > 0;
process.stdout.write(`\nresult: ${failed ? "FINDINGS" : "clean"}\n`);
process.exitCode = failed ? 1 : 0;

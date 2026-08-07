/**
 * Shared file-selection policy for the source release archive.
 *
 * Audit finding P1-02: the inherited `release-archive.mjs` tarred `.` with a
 * handful of `--exclude` flags, so the archive contained whatever happened to
 * be sitting in the working tree — including untracked local files and
 * anything matching no exclude pattern, such as `.env`. Selection is now an
 * allowlist: a file has to be *chosen* to be shipped.
 *
 * Two independent gates apply, in this order:
 *   1. a candidate list (tracked files from `git ls-files`, or a walk of the
 *      allowlisted directories when the tree is not a git checkout);
 *   2. an allowlist membership check (directory / root / selected data paths);
 *   3. a deny list that no candidate may match, whatever its source.
 *
 * The deny list is the backstop: even if `git ls-files` reports a committed
 * `.env`, it never reaches the archive.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";

/** Directories that are never walked and never archived, at any depth. */
export const DENIED_DIRECTORIES = new Set([
  ".git",
  ".data",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vite",
  ".cache",
  "playwright-report",
  "test-results",
]);

/**
 * Path predicates that reject a file outright. Each entry is
 * `[label, (relPosixPath, basename) => boolean]` so a rejection can be
 * explained rather than silently applied.
 */
export const DENY_RULES = [
  ["dotenv", (_rel, base) => base === ".env" || base.startsWith(".env.")],
  ["log", (_rel, base) => base.endsWith(".log")],
  ["secret-material", (_rel, base) => /\.(pem|key|pfx|p12|keystore|jks)$/i.test(base)],
  ["npm-auth", (_rel, base) => base === ".npmrc" || base === ".yarnrc" || base === ".netrc"],
  ["credentials", (_rel, base) => /^(credentials|secrets?)\.(json|ya?ml|toml)$/i.test(base)],
  ["build-info", (_rel, base) => base.endsWith(".tsbuildinfo")],
  ["release-output", (rel) => rel === "data/release" || rel.startsWith("data/release/")],
  ["archive", (_rel, base) => /\.(tar|tgz|tar\.gz|zip)$/i.test(base)],
  ["denied-directory", (rel) => rel.split("/").some((segment) => DENIED_DIRECTORIES.has(segment))],
];

/**
 * Top-level directories included in full (minus denied paths). These are the
 * inputs a reviewer needs to rebuild and re-verify the project from source.
 * Public `data/` assets are selected separately (see `isAllowedDataPath`).
 */
export const ALLOWED_DIRECTORIES = [
  ".github",
  ".cursor",
  "apps",
  "docs",
  "packages",
  "scenarios",
  "scripts",
  "templates",
  "workpacks",
];

/** Exact public files under `data/` (plus `data/evidence/**` and m4 artifacts). */
export const ALLOWED_DATA_FILES = new Set([
  "data/benchmark-smoke/report.md",
  "data/benchmark-smoke/report.json",
]);

/**
 * @param {string} relative POSIX-style path
 * @returns {boolean}
 */
export function isAllowedDataPath(relative) {
  if (ALLOWED_DATA_FILES.has(relative)) {
    return true;
  }
  if (relative.startsWith("data/evidence/")) {
    return true;
  }
  if (/^data\/m4-run-.+\.artifact\.json$/.test(relative)) {
    return true;
  }
  return false;
}

/** Individual top-level files included by exact name. */
export const ALLOWED_ROOT_FILES = [
  ".dockerignore",
  ".gitignore",
  "00_NORTH_STAR.md",
  "01_TARGET_ARCHITECTURE.md",
  "02_MILESTONE_PLAN.md",
  "02_MILESTONE_ROADMAP.md",
  "03_RELEASE_GATE.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CITATION.cff",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "Dockerfile",
  "EVIDENCE.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "STATUS.md",
  "docker-compose.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.workspace.ts",
];

const ALLOWED_ROOT_SET = new Set(ALLOWED_ROOT_FILES);
const ALLOWED_DIR_SET = new Set(ALLOWED_DIRECTORIES);

function toPosix(relative) {
  return relative.split(sep).join(posix.sep);
}

/**
 * @param {string} relative POSIX-style path relative to the repository root
 * @returns {string | null} the deny-rule label, or null when the file is allowed
 */
export function denyReason(relative) {
  const base = relative.slice(relative.lastIndexOf("/") + 1);
  for (const [label, matches] of DENY_RULES) {
    if (matches(relative, base)) {
      return label;
    }
  }
  return null;
}

export function isDenied(relative) {
  return denyReason(relative) !== null;
}

/**
 * Membership in the public-release allowlist (independent of deny rules).
 * @param {string} relative
 * @returns {boolean}
 */
export function isAllowlisted(relative) {
  if (ALLOWED_ROOT_SET.has(relative)) {
    return true;
  }
  if (relative === "data" || relative.startsWith("data/")) {
    return isAllowedDataPath(relative);
  }
  const top = relative.split("/")[0] ?? "";
  return ALLOWED_DIR_SET.has(top);
}

function gitTrackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const files = result.stdout.split("\0").filter((entry) => entry.length > 0);
  return files.length > 0 ? files : null;
}

function walk(root, relativeDir, out) {
  let entries;
  try {
    entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      // A symlink can point outside the tree; never follow one into an archive.
      continue;
    }
    const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (DENIED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      walk(root, relative, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    out.push(relative);
  }
}

function allowlistFiles(root) {
  const out = [];
  for (const dir of ALLOWED_DIRECTORIES) {
    try {
      if (!statSync(join(root, dir)).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    walk(root, dir, out);
  }
  // Selected public data assets only (never `data/release/**`).
  try {
    if (statSync(join(root, "data")).isDirectory()) {
      walk(root, "data", out);
    }
  } catch {
    // optional
  }
  for (const name of ALLOWED_ROOT_FILES) {
    try {
      if (statSync(join(root, name)).isFile()) {
        out.push(name);
      }
    } catch {
      // optional file, not present in this tree
    }
  }
  return out;
}

/**
 * @param {string} root repository root
 * @returns {{ source: "git" | "allowlist", files: string[], excluded: Array<{ path: string, reason: string }> }}
 */
export function collectReleaseFiles(root) {
  const tracked = gitTrackedFiles(root);
  const source = tracked ? "git" : "allowlist";
  const candidates = (tracked ?? allowlistFiles(root)).map(toPosix);

  const files = [];
  const excluded = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (!isAllowlisted(candidate)) {
      excluded.push({ path: candidate, reason: "not-allowlisted" });
      continue;
    }
    const reason = denyReason(candidate);
    if (reason) {
      excluded.push({ path: candidate, reason });
      continue;
    }
    files.push(candidate);
  }
  files.sort();
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { source, files, excluded };
}

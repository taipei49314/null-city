#!/usr/bin/env node
/**
 * `pnpm verify:markdown-links` — fail when a tracked Markdown file links to a
 * missing relative path (or embeds a missing relative image).
 *
 * Allowed exceptions:
 * - Absolute http(s) URLs (including GitHub security advisories)
 * - Fragment-only anchors (`#section`)
 * - mailto: / data: / javascript: schemes
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, posix, resolve, sep } from "node:path";

const root = process.cwd();

const LINK_RE = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function toPosix(relative) {
  return relative.split(sep).join(posix.sep);
}

function gitTrackedMarkdown() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--exclude-standard", "*.md"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!result.error && result.status === 0) {
    const files = result.stdout.split("\0").filter((entry) => entry.length > 0);
    if (files.length > 0) {
      return files.map(toPosix);
    }
  }
  return null;
}

function walkMarkdown(relativeDir, out) {
  let entries;
  try {
    entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        ["node_modules", ".git", "dist", "build", "coverage", ".turbo", ".vite", "_audit"].includes(
          entry.name,
        )
      ) {
        continue;
      }
      walkMarkdown(relative, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relative);
    }
  }
}

function listMarkdownFiles() {
  const tracked = gitTrackedMarkdown();
  const files = tracked ?? (() => {
    const out = [];
    walkMarkdown("", out);
    return out;
  })();
  // Audit unpacks / local recovery trees are not part of the public doc graph.
  return files.filter((file) => !file.startsWith("_audit/")).sort();
}

function isExternalOrAnchor(href) {
  if (href.startsWith("#")) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return true;
  // GitHub SECURITY.md template: relative path to the advisories UI.
  if (/security\/advisories\/new\/?$/i.test(href)) return true;
  return false;
}

function stripQueryAndHash(href) {
  const noHash = href.split("#")[0] ?? href;
  return noHash.split("?")[0] ?? noHash;
}

function checkFile(relPosix) {
  const absolute = join(root, ...relPosix.split("/"));
  const text = readFileSync(absolute, "utf8");
  const missing = [];
  let match;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(text)) !== null) {
    const href = match[2];
    if (!href || isExternalOrAnchor(href)) continue;
    const pathPart = stripQueryAndHash(href);
    if (!pathPart) continue;
    // Windows drive / absolute filesystem links are out of scope for the gate.
    if (pathPart.startsWith("/") || /^[A-Za-z]:/.test(pathPart)) continue;
    const target = resolve(dirname(absolute), pathPart);
    const normalizedRoot = resolve(root);
    const relativeToRoot = toPosix(
      normalize(target).startsWith(normalizedRoot)
        ? target.slice(normalizedRoot.length).replace(/^[/\\]/, "")
        : target,
    );
    if (!existsSync(target)) {
      missing.push({ href, target: relativeToRoot });
    } else {
      try {
        const st = statSync(target);
        if (!st.isFile() && !st.isDirectory()) {
          missing.push({ href, target: relativeToRoot });
        }
      } catch {
        missing.push({ href, target: relativeToRoot });
      }
    }
  }
  return missing;
}

const files = listMarkdownFiles();
const failures = [];
for (const file of files) {
  const missing = checkFile(file);
  for (const item of missing) {
    failures.push(`${file}: missing ${item.href} (resolved ${item.target})`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`FAIL markdown-links: ${failures.length} broken relative link(s)\n`);
  for (const line of failures.slice(0, 50)) {
    process.stderr.write(`  ${line}\n`);
  }
  if (failures.length > 50) {
    process.stderr.write(`  … and ${failures.length - 50} more\n`);
  }
  process.exit(1);
}

process.stdout.write(`PASS markdown-links: ${files.length} markdown file(s) checked, 0 missing targets\n`);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "src");

/**
 * The MCP adapter is player-facing and, unlike the benchmark runner, never
 * needs to own a server process (it always connects to an already-running
 * one via `baseUrl`). So `src/` may import only `@null-city/sdk`,
 * `@null-city/contracts` (public symbols), `@modelcontextprotocol/sdk`,
 * and `zod` — never `@null-city/simulation`, `@null-city/epistemics`, nor
 * `@null-city/server`.
 */
const FORBIDDEN_PACKAGE_PATTERNS = [
  /from\s+["']@null-city\/simulation(?:\/[^"']*)?["']/,
  /from\s+["']@null-city\/epistemics(?:\/[^"']*)?["']/,
  /from\s+["']@null-city\/server(?:\/[^"']*)?["']/,
  /import\(\s*["']@null-city\/(?:simulation|epistemics|server)(?:\/[^"']*)?["']\s*\)/,
  /require\(\s*["']@null-city\/(?:simulation|epistemics|server)(?:\/[^"']*)?["']\s*\)/,
  /["']@null-city\/contracts\/truth["']/,
];

const FORBIDDEN_CONTRACTS_SYMBOLS = new Set([
  "TruthEvent",
  "TruthEventEnvelope",
  "asTruthEvent",
  "EventEnvelope",
  "EventKindName",
  "GlobalState",
  "DistrictState",
  "TruthState",
  "RouteState",
  "TeamState",
  "ResourceState",
  "InternalState",
  "IncidentState",
  "ScheduledEffectState",
  "VerificationState",
  "WorkItem",
  "EffectPayload",
  "ScoreState",
  "ScoreBreakdownItem",
  "TeamOrderRef",
  "TeamStatus",
]);

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function namedImportsFrom(source: string, pkg: string): string[] {
  const names: string[] = [];
  const importRegex = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+["']${pkg}["']`, "g");
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    for (const raw of match[1]!.split(",")) {
      const cleaned = raw.trim().split(/\s+as\s+/)[0]!.trim().replace(/^type\s+/, "");
      if (cleaned.length > 0) {
        names.push(cleaned);
      }
    }
  }
  return names;
}

describe("forbidden imports (player-facing boundary)", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("never imports @null-city/simulation, @null-city/epistemics, or @null-city/server from src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_PACKAGE_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${file} matches ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never imports truth-only symbols from @null-city/contracts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of namedImportsFrom(source, "@null-city/contracts")) {
        if (FORBIDDEN_CONTRACTS_SYMBOLS.has(name)) {
          offenders.push(`${file} imports truth-only symbol ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never registers a tool whose name suggests truth/snapshot/admin access", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const toolNameRegex = /registerTool\(\s*["'`]([^"'`]+)["'`]/g;
      let match: RegExpExecArray | null;
      while ((match = toolNameRegex.exec(source)) !== null) {
        const name = match[1]!;
        if (/truth|snapshot|internal|admin/i.test(name)) {
          offenders.push(`${file} registers forbidden tool name ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

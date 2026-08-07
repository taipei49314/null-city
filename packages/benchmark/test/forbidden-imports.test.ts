import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "src");

/**
 * The benchmark runner is a player-facing package: policies and metrics
 * must never see truth. It is allowed to import `@null-city/server`'s
 * `createServer`/`NullCityServer` to spin an ephemeral local server (the
 * same public REST/WS surface a real deployment exposes) — see
 * `runner.ts` — but must never import `@null-city/simulation` or
 * `@null-city/epistemics`, nor any truth-only symbol from
 * `@null-city/contracts`.
 */
const FORBIDDEN_PACKAGE_PATTERNS = [
  /from\s+["']@null-city\/simulation(?:\/[^"']*)?["']/,
  /from\s+["']@null-city\/epistemics(?:\/[^"']*)?["']/,
  /import\(\s*["']@null-city\/(?:simulation|epistemics)(?:\/[^"']*)?["']\s*\)/,
  /require\(\s*["']@null-city\/(?:simulation|epistemics)(?:\/[^"']*)?["']\s*\)/,
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

/** `runner.ts` may only reach into `@null-city/server`'s process-lifecycle surface. */
const ALLOWED_SERVER_IMPORTS = new Set(["createServer", "NullCityServer"]);

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
    expect(files.length).toBeGreaterThan(5);
  });

  it("never imports @null-city/simulation or @null-city/epistemics from src/", () => {
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

  it("only imports createServer/NullCityServer from @null-city/server (never hub/rpc/engine internals)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of namedImportsFrom(source, "@null-city/server")) {
        if (!ALLOWED_SERVER_IMPORTS.has(name)) {
          offenders.push(`${file} imports ${name} from @null-city/server`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

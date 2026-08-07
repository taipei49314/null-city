import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "src");

/**
 * The SDK is a player-facing package: it must never import
 * `@null-city/simulation` or `@null-city/epistemics` (both truth-adjacent),
 * nor any truth-only symbol from `@null-city/contracts`. This mirrors
 * `apps/command-center/test/forbidden-imports.test.ts` exactly, scanning
 * the actual shipped source tree rather than trusting a comment.
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
  "ScenarioStartedPayload",
  "TrueIncidentOccurredPayload",
  "IncidentChainedPayload",
  "IncidentResolvedPayload",
  "ObservationCreatedPayload",
  "ObservationDelayedPayload",
  "ObservationCorruptedPayload",
  "ObservationLostPayload",
  "ObservationDeliveredPayload",
  "CommandIssuedPayload",
  "CommandRejectedPayload",
  "CommandAcceptedPayload",
  "TeamDispatchedPayload",
  "TeamArrivedPayload",
  "ActionAppliedPayload",
  "SystemStateChangedPayload",
  "ScoreChangedPayload",
  "ScenarioCompletedPayload",
  "EventPayload",
]);

const FORBIDDEN_NAMED_EXPORTS = new Set(["adminSnapshot", "sessionSnapshot", "listSessions", "deleteSession"]);

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

function namedImportsFromContracts(source: string): string[] {
  const names: string[] = [];
  const importRegex = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@null-city\/contracts["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    for (const raw of match[1]!.split(",")) {
      const cleaned = raw.trim().split(/\s+as\s+/)[0]!.trim();
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
      for (const name of namedImportsFromContracts(source)) {
        if (FORBIDDEN_CONTRACTS_SYMBOLS.has(name)) {
          offenders.push(`${file} imports truth-only symbol ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exposes no internal/admin method names anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of FORBIDDEN_NAMED_EXPORTS) {
        if (source.includes(name)) {
          offenders.push(`${file} references ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

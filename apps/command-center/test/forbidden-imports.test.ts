import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "src");

/**
 * Player-facing packages must never import `@null-city/simulation` or any
 * truth-only symbol from `@null-city/contracts` (see
 * `packages/contracts/src/truth.ts` and the truth-side interfaces in
 * `types.ts`). This scans the actual shipped source tree rather than
 * trusting a comment, so a regression here fails the build honestly.
 */
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']@null-city\/simulation(?:\/[^"']*)?["']/,
  /import\(\s*["']@null-city\/simulation(?:\/[^"']*)?["']\s*\)/,
  /require\(\s*["']@null-city\/simulation(?:\/[^"']*)?["']\s*\)/,
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

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
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

  it("scans at least the expected source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never imports @null-city/simulation anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${file} imports @null-city/simulation`);
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
});

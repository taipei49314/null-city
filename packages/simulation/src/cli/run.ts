import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario, type Scenario } from "@null-city/scenario-schema";
import { loadScenario } from "@null-city/test-fixtures";

import { loadArtifact, verifyRunArtifact, type RunArtifact, type ArtifactVerifyResult } from "../artifact.js";

/** Exit: full FAIL. */
const EXIT_FAIL = 1;
/** Exit: integrity-only / partial verification (not a full PASS). */
const EXIT_PARTIAL = 2;

function requireArtifactPath(values: Record<string, string | boolean | undefined>, flag: string): string {
  const path = values[flag];
  if (typeof path !== "string" || !path) {
    throw new Error(`--${flag} <path> is required`);
  }
  return path;
}

function printIdentity(artifact: RunArtifact, prefix = ""): void {
  process.stdout.write(`${prefix}session       : ${artifact.identity.sessionId}\n`);
  process.stdout.write(`${prefix}scenario      : ${artifact.identity.scenarioId}\n`);
  process.stdout.write(`${prefix}scenarioDigest: ${artifact.identity.scenarioDigest.slice(0, 16)}\n`);
  process.stdout.write(`${prefix}seed          : ${artifact.identity.seed}\n`);
  process.stdout.write(`${prefix}finalTick     : ${artifact.finalTick} / ${artifact.identity.totalTicks}\n`);
  process.stdout.write(`${prefix}score         : ${artifact.scoreTotal}\n`);
  process.stdout.write(`${prefix}truth events  : ${artifact.eventCount}\n`);
  process.stdout.write(`${prefix}player events : ${artifact.playerEventCount}\n`);
  process.stdout.write(`${prefix}commands      : ${artifact.commandTrace.length}\n`);
  process.stdout.write(`${prefix}assessments   : ${artifact.assessmentTrace.length}\n`);
  process.stdout.write(`${prefix}public actions: ${artifact.publicActionLedger?.length ?? 0}\n`);
  process.stdout.write(`${prefix}handled       : ${artifact.handledIncidents.join(",") || "(none)"}\n`);
  process.stdout.write(`${prefix}still active  : ${artifact.activeIncidents.join(",") || "(none)"}\n`);
  process.stdout.write(`${prefix}artifactHash  : ${artifact.artifactHash.slice(0, 16)}\n`);
  process.stdout.write(`${prefix}signature     : ${artifact.signature ? "present (metadata only)" : "none"}\n`);
}

function resolveScenario(artifact: RunArtifact, scenarioPath: string | undefined): Scenario | undefined {
  if (scenarioPath) {
    const abs = resolve(scenarioPath);
    if (!existsSync(abs)) {
      throw new Error(`scenario file does not exist: ${abs}`);
    }
    const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
    return validateScenario(raw);
  }
  try {
    return loadScenario(artifact.identity.scenarioId);
  } catch {
    return undefined;
  }
}

function printVerifyReport(
  mode: "full" | "integrity-only",
  artifact: RunArtifact,
  result: ArtifactVerifyResult,
): void {
  const machine = {
    mode,
    ok: result.ok,
    integrityOk: result.integrityOk,
    truthReplay: result.replayChecked,
    playerProjectionReplay: result.playerReplayChecked,
    authenticity: result.authenticity,
    reasons: result.reasons,
    sessionId: artifact.identity.sessionId,
    scenarioId: artifact.identity.scenarioId,
    artifactHash: artifact.artifactHash,
  };
  process.stdout.write(`report_json=${JSON.stringify(machine)}\n`);
  process.stdout.write(`integrity          : ${result.integrityOk ? "OK" : "FAIL"}\n`);
  process.stdout.write(`truth_replay       : ${result.replayChecked ? "CHECKED" : "NOT_CHECKED"}\n`);
  process.stdout.write(
    `player_proj_replay : ${result.playerReplayChecked ? "CHECKED" : "NOT_CHECKED"}\n`,
  );
  process.stdout.write(`authenticity       : ${result.authenticity}\n`);
}

function cmdVerify(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      artifact: { type: "string" },
      scenario: { type: "string" },
      "integrity-only": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const path = requireArtifactPath(values as Record<string, string | boolean | undefined>, "artifact");
  const integrityOnly = Boolean(values["integrity-only"]);
  const artifact = loadArtifact(path);

  if (integrityOnly) {
    const result = verifyRunArtifact(artifact, { requireReplay: false });
    printVerifyReport("integrity-only", artifact, result);
    if (!result.integrityOk) {
      process.stderr.write("FAIL integrity-only verification:\n");
      for (const reason of result.reasons) {
        process.stderr.write(`  - ${reason}\n`);
      }
      process.exitCode = EXIT_FAIL;
      return;
    }
    process.stdout.write(
      `PARTIAL integrity-only ${artifact.identity.sessionId} hash=${artifact.artifactHash.slice(0, 16)} ` +
        `(no scenario replay; not a full PASS)\n`,
    );
    process.exitCode = EXIT_PARTIAL;
    return;
  }

  const scenario = resolveScenario(artifact, typeof values.scenario === "string" ? values.scenario : undefined);
  if (!scenario) {
    process.stderr.write(
      "FAIL full verification: could not resolve compiled scenario. " +
        "Pass --scenario <path> or ensure the scenario id is in the fixture registry.\n",
    );
    process.exitCode = EXIT_FAIL;
    return;
  }

  const result = verifyRunArtifact(artifact, { scenario, requireReplay: true });
  printVerifyReport("full", artifact, result);
  if (!result.ok) {
    process.stderr.write("FAIL full verification:\n");
    for (const reason of result.reasons) {
      process.stderr.write(`  - ${reason}\n`);
    }
    process.exitCode = EXIT_FAIL;
    return;
  }
  process.stdout.write(
    `PASS full verification ${artifact.identity.sessionId} hash=${artifact.artifactHash.slice(0, 16)} ` +
      `events=${artifact.eventCount} score=${artifact.scoreTotal} ` +
      `truth_replay=yes player_replay=yes\n`,
  );
}

function cmdInspect(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: { artifact: { type: "string" } } });
  const path = requireArtifactPath(values as Record<string, string | boolean | undefined>, "artifact");
  const artifact = loadArtifact(path);
  process.stdout.write("=== run artifact inspect ===\n");
  printIdentity(artifact);
  process.stdout.write("commands:\n");
  for (const entry of artifact.commandTrace) {
    process.stdout.write(
      `  T${entry.issuedTick.toString().padStart(4)} ${entry.commandName.padEnd(24)} ${entry.outcome.padEnd(8)} ${entry.target ?? ""} ${entry.errorMessage ?? ""}\n`,
    );
  }
  process.stdout.write("assessments:\n");
  for (const entry of artifact.assessmentTrace) {
    process.stdout.write(
      `  T${entry.submittedTick.toString().padStart(4)} claim=${entry.claimId} p=${entry.probability.toFixed(2)} conf=${entry.confidence.toFixed(2)}\n`,
    );
  }
  process.stdout.write("public actions:\n");
  for (const action of artifact.publicActionLedger ?? []) {
    if (action.kind === "command") {
      process.stdout.write(
        `  T${action.atTick.toString().padStart(4)} command ${action.commandName} key=${action.idempotencyKey}\n`,
      );
    } else {
      process.stdout.write(
        `  T${action.atTick.toString().padStart(4)} assessment claim=${action.claimId} id=${action.id}\n`,
      );
    }
  }
}

function cmdCompare(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      artifact: { type: "string" },
      artifact2: { type: "string" },
      scenario: { type: "string" },
    },
  });
  const pathA = requireArtifactPath(values as Record<string, string | boolean | undefined>, "artifact");
  const pathB = requireArtifactPath(values as Record<string, string | boolean | undefined>, "artifact2");
  const a = loadArtifact(pathA);
  const b = loadArtifact(pathB);

  process.stdout.write("=== run artifact compare ===\n");
  process.stdout.write("--- run A ---\n");
  printIdentity(a, "  ");
  process.stdout.write("--- run B ---\n");
  printIdentity(b, "  ");

  const sameScenario = a.identity.scenarioDigest === b.identity.scenarioDigest;
  process.stdout.write(`\nsame scenario digest: ${sameScenario ? "yes" : "no"}\n`);
  if (!sameScenario) {
    process.stdout.write(
      "  runs are not directly comparable (different scenario content); showing raw values only.\n",
    );
  }

  process.stdout.write(`score delta (B - A)       : ${(b.scoreTotal - a.scoreTotal).toFixed(2)}\n`);
  process.stdout.write(`final tick delta (B - A)  : ${b.finalTick - a.finalTick}\n`);
  process.stdout.write(`handled incidents A/B     : ${a.handledIncidents.length} / ${b.handledIncidents.length}\n`);
  process.stdout.write(`active incidents A/B      : ${a.activeIncidents.length} / ${b.activeIncidents.length}\n`);
  process.stdout.write(`commands A/B              : ${a.commandTrace.length} / ${b.commandTrace.length}\n`);
  process.stdout.write(`assessments A/B           : ${a.assessmentTrace.length} / ${b.assessmentTrace.length}\n`);

  const scenarioPath = typeof values.scenario === "string" ? values.scenario : undefined;
  const scenarioA = resolveScenario(a, scenarioPath);
  const scenarioB = resolveScenario(b, scenarioPath);
  const verifyA = scenarioA
    ? verifyRunArtifact(a, { scenario: scenarioA, requireReplay: true })
    : verifyRunArtifact(a, { requireReplay: true });
  const verifyB = scenarioB
    ? verifyRunArtifact(b, { scenario: scenarioB, requireReplay: true })
    : verifyRunArtifact(b, { requireReplay: true });

  const label = (result: ArtifactVerifyResult, hasScenario: boolean): string => {
    if (!hasScenario || !result.replayChecked || !result.playerReplayChecked) {
      return `NOT independently fully verified (${result.reasons.join("; ") || "scenario/replay missing"})`;
    }
    return result.ok ? "PASS full verification" : `FAIL (${result.reasons.join("; ")})`;
  };

  process.stdout.write(`independent verify A      : ${label(verifyA, Boolean(scenarioA))}\n`);
  process.stdout.write(`independent verify B      : ${label(verifyB, Boolean(scenarioB))}\n`);

  if (!verifyA.ok || !verifyB.ok || !scenarioA || !scenarioB) {
    process.exitCode = EXIT_FAIL;
  }
}

function main(): void {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "verify":
      return cmdVerify(rest);
    case "inspect":
      return cmdInspect(rest);
    case "compare":
      return cmdCompare(rest);
    default:
      throw new Error(
        `usage: run <verify|inspect|compare> --artifact <path> [--artifact2 <path>] [--scenario <path>] [--integrity-only]`,
      );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = EXIT_FAIL;
}

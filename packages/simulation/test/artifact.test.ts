import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { blackRiver, goldenScript } from "@null-city/test-fixtures";
import { SimulationEngine, scenarioDigest } from "../src/index.js";
import {
  ArtifactParseError,
  MAX_ARTIFACT_BYTES,
  RUN_ARTIFACT_FORMAT,
  RUN_ARTIFACT_VERSION,
  buildRunArtifact,
  loadArtifact,
  parseArtifactJson,
  saveArtifact,
  verifyRunArtifact,
} from "../src/artifact.js";
import type { PublicAction } from "../src/public-actions.js";
import { replayFromPublicActions } from "../src/public-replay.js";

const SEED = 49314;

function ledgerFromGolden(): PublicAction[] {
  return goldenScript().map((step) => ({
    kind: "command" as const,
    atTick: step.atTick,
    commandName: step.commandName,
    params: { ...step.params },
    idempotencyKey: step.idempotencyKey,
  }));
}

function completedRun(
  seed: number,
  sessionId: string,
): {
  engine: SimulationEngine;
  playerEvents: PlayerEventEnvelope[];
  actions: PublicAction[];
} {
  const actions = ledgerFromGolden();
  const rebuilt = replayFromPublicActions({
    scenario: blackRiver(),
    seed,
    sessionId,
    actions,
  });
  return { engine: rebuilt.engine, playerEvents: [...rebuilt.playerEvents], actions };
}

describe("run artifact", () => {
  it("builds a well-formed, independently verifiable artifact from a completed run", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-1");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });

    expect(artifact.format).toBe(RUN_ARTIFACT_FORMAT);
    expect(artifact.version).toBe(RUN_ARTIFACT_VERSION);
    expect(artifact.identity.sessionId).toBe("artifact-1");
    expect(artifact.commandTrace.length).toBe(goldenScript().length);
    expect(artifact.commandTrace.every((c) => c.outcome === "accepted")).toBe(true);
    expect(artifact.truth.events.length).toBe(engine.eventLog.length);
    expect(artifact.player.events.length).toBe(playerEvents.length);
    expect(artifact.publicActionLedger.length).toBe(actions.length);
    expect(artifact.signature).toBeNull();

    const result = verifyRunArtifact(artifact, { scenario: blackRiver(), requireReplay: true });
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.playerReplayChecked).toBe(true);
  });

  it("throws when building from a truth log that has not reached ScenarioCompleted", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: SEED, sessionId: "artifact-incomplete" });
    const step = goldenScript()[0]!;
    engine.submitCommand(step.commandName as never, step.params, step.idempotencyKey);
    expect(() =>
      buildRunArtifact({
        result: engine.result(),
        scenarioDigest: scenarioDigest(engine.scenario),
        truthEvents: engine.eventLog,
        playerEvents: [
          {
            stream: "player",
            sessionId: "artifact-incomplete",
            sequence: 0,
            tick: 0,
            kind: "SessionStarted",
            payload: {
              scenarioId: "black-river",
              seed: SEED,
              totalTicks: engine.scenario.totalTicks,
              teams: [],
              routes: [],
              resources: { backupGenerators: 0, advisoryUses: 0 },
            },
            previousHash: "",
            hash: "0".repeat(64),
          } as PlayerEventEnvelope,
        ],
      }),
    ).toThrow(/not completed/);
  });

  it("round-trips through save/load and stays verifiable", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-roundtrip");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const dir = mkdtempSync(join(tmpdir(), "null-city-artifact-"));
    const path = join(dir, "run.artifact.json");
    saveArtifact(path, artifact);
    const loaded = loadArtifact(path);
    expect(verifyRunArtifact(loaded, { scenario: blackRiver(), requireReplay: true }).ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a tampered truth event", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-tamper-truth");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const tampered = structuredClone(artifact);
    tampered.truth.events[3]!.payload = { ...(tampered.truth.events[3]!.payload as object), tampered: true };
    const result = verifyRunArtifact(tampered);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("truth stream invalid") || r.includes("artifactHash"))).toBe(true);
  });

  it("rejects a tampered player event", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-tamper-player");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const tampered = structuredClone(artifact);
    const evidenceEvent = tampered.player.events.find((e) => e.kind === "EvidenceRecorded");
    expect(evidenceEvent).toBeDefined();
    evidenceEvent!.payload = { ...(evidenceEvent!.payload as object), tampered: true };
    const result = verifyRunArtifact(tampered);
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered score total without touching the event logs", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-tamper-score");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const tampered = { ...artifact, scoreTotal: artifact.scoreTotal + 999 };
    const result = verifyRunArtifact(tampered);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("artifactHash mismatch");
  });

  it("rejects a tampered command trace entry", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-tamper-command");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const tampered = structuredClone(artifact);
    tampered.commandTrace[0]!.outcome = "rejected";
    const result = verifyRunArtifact(tampered);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("commandTrace") || r.includes("artifactHash"))).toBe(true);
  });

  it("parseArtifactJson rejects malformed JSON, wrong shape, and oversized input", () => {
    expect(() => parseArtifactJson("{not json")).toThrow(ArtifactParseError);
    expect(() => parseArtifactJson(JSON.stringify({ format: "wrong" }))).toThrow(ArtifactParseError);
    expect(() => parseArtifactJson(JSON.stringify([1, 2, 3]))).toThrow(ArtifactParseError);
    const oversized = JSON.stringify({
      format: RUN_ARTIFACT_FORMAT,
      version: RUN_ARTIFACT_VERSION,
      pad: "x".repeat(MAX_ARTIFACT_BYTES + 10),
    });
    expect(() => parseArtifactJson(oversized)).toThrow(/maximum accepted size/);
  });

  it("parseArtifactJson accepts a real artifact's serialized form", () => {
    const { engine, playerEvents, actions } = completedRun(SEED, "artifact-parse-ok");
    const artifact = buildRunArtifact({
      result: engine.result(),
      scenarioDigest: scenarioDigest(engine.scenario),
      truthEvents: engine.eventLog,
      playerEvents,
      publicActionLedger: actions,
    });
    const parsed = parseArtifactJson(JSON.stringify(artifact));
    expect(verifyRunArtifact(parsed).ok).toBe(true);
  });
});

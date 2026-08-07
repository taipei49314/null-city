import { describe, expect, it } from "vitest";

import {
  GENESIS_PREVIOUS_HASH,
  canonicalJson,
  eventHash,
  playerEventHash,
  sha256,
  type EventEnvelope,
  type PlayerEventEnvelope,
} from "@null-city/contracts/truth";
import { blackRiver, goldenScript } from "@null-city/test-fixtures";

import { scenarioDigest } from "../src/index.js";
import { buildRunArtifact, verifyRunArtifact, type RunArtifact } from "../src/artifact.js";
import type { PublicAction } from "../src/public-actions.js";
import { replayFromPublicActions } from "../src/public-replay.js";

/**
 * External audit reproduction ART-01..ART-05 plus M10 player-history rebuild.
 *
 * Every attack below re-chains event logs and recomputes `artifactHash`.
 */

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

function honestArtifact(sessionId: string): RunArtifact {
  const scenario = blackRiver();
  const actions = ledgerFromGolden();
  const rebuilt = replayFromPublicActions({ scenario, seed: SEED, sessionId, actions });
  return buildRunArtifact({
    result: rebuilt.result,
    scenarioDigest: scenarioDigest(scenario),
    truthEvents: rebuilt.engine.eventLog,
    playerEvents: rebuilt.playerEvents,
    publicActionLedger: actions,
  });
}

/** Recomputes the truth chain in place, as a forger with the same code would. */
function rechainTruth(events: EventEnvelope[]): void {
  let previousHash = GENESIS_PREVIOUS_HASH;
  events.forEach((event, index) => {
    event.sequence = index;
    event.previousHash = previousHash;
    event.hash = eventHash(event);
    previousHash = event.hash;
  });
}

/** Recomputes the player chain in place. */
function rechainPlayer(events: PlayerEventEnvelope[]): void {
  let previousHash = GENESIS_PREVIOUS_HASH;
  events.forEach((event, index) => {
    event.sequence = index;
    event.previousHash = previousHash;
    event.hash = playerEventHash(event);
    previousHash = event.hash;
  });
}

/** Recomputes every derived hash the forger controls, then reseals the artifact. */
function reseal(artifact: RunArtifact): RunArtifact {
  rechainTruth(artifact.truth.events);
  rechainPlayer(artifact.player.events);
  artifact.eventCount = artifact.truth.events.length;
  artifact.playerEventCount = artifact.player.events.length;
  artifact.truthLogHash = artifact.truth.events[artifact.truth.events.length - 1]?.hash ?? "";
  artifact.playerLogHash = artifact.player.events[artifact.player.events.length - 1]?.hash ?? "";
  const { artifactHash, ...body } = artifact;
  void artifactHash;
  artifact.artifactHash = sha256(canonicalJson(body));
  return artifact;
}

function expectRejected(artifact: RunArtifact): string[] {
  const result = verifyRunArtifact(artifact);
  expect(result.reasons).not.toEqual([]);
  expect(result.ok).toBe(false);
  return result.reasons;
}

describe("adversarial run artifact (audit ART-01..ART-05)", () => {
  it("baseline: an untouched artifact still verifies, and resealing alone does not break it", () => {
    const artifact = honestArtifact("art-baseline");
    expect(verifyRunArtifact(artifact).ok).toBe(true);
    const withReplay = verifyRunArtifact(artifact, { scenario: blackRiver(), requireReplay: true });
    expect(withReplay.ok).toBe(true);
    expect(withReplay.playerReplayChecked).toBe(true);
    const resealed = reseal(structuredClone(artifact));
    expect(resealed.artifactHash).toBe(artifact.artifactHash);
    expect(resealed.truthLogHash).toBe(artifact.truthLogHash);
    expect(verifyRunArtifact(resealed).ok).toBe(true);
  });

  it("ART-01 rejects a forged identity (scenario, seed, totalTicks, stateDigest) even after rehashing", () => {
    const artifact = reseal(
      Object.assign(structuredClone(honestArtifact("art-01")), {
        stateDigest: sha256("forged-terminal-state"),
      }),
    );
    artifact.identity.scenarioId = "glass-harbor";
    artifact.identity.scenarioDigest = sha256("forged-scenario");
    artifact.identity.seed = 1;
    artifact.identity.totalTicks = 9;
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("identity.scenarioId"))).toBe(true);
    expect(reasons.some((r) => r.includes("identity.seed"))).toBe(true);
    expect(reasons.some((r) => r.includes("identity.totalTicks"))).toBe(true);
  });

  it("ART-01b rejects a forged stateDigest when the scenario is available for replay", () => {
    const artifact = honestArtifact("art-01b");
    artifact.stateDigest = sha256("forged-terminal-state");
    reseal(artifact);

    const result = verifyRunArtifact(artifact, { scenario: blackRiver() });
    expect(result.replayChecked).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      "stateDigest does not match the terminal state recomputed by deterministic replay",
    );
  });

  it("ART-02 rejects an artifact whose RunCompleted has been removed", () => {
    const artifact = honestArtifact("art-02");
    const before = artifact.player.events.length;
    artifact.player.events = artifact.player.events.filter((e) => e.kind !== "RunCompleted");
    expect(artifact.player.events.length).toBeLessThan(before);
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("player stream: stream contains no RunCompleted"))).toBe(true);
  });

  it("ART-03 rejects a truth event appended after ScenarioCompleted", () => {
    const artifact = honestArtifact("art-03");
    const last = artifact.truth.events[artifact.truth.events.length - 1]!;
    artifact.truth.events.push({
      ...structuredClone(last),
      kind: "SystemStateChanged",
      payload: { districts: {}, teams: {}, routes: {}, resources: {} },
    } as EventEnvelope);
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("nothing may follow the terminal event"))).toBe(true);
  });

  it("ART-04 rejects a array substituted for a SystemStateChanged payload", () => {
    const artifact = honestArtifact("art-04");
    const target = artifact.truth.events.find((e) => e.kind === "SystemStateChanged");
    expect(target).toBeDefined();
    (target as { payload: unknown }).payload = ["not", "an", "object"];
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("truth stream invalid"))).toBe(true);
  });

  it("ART-05 rejects a negative tick on the player genesis event", () => {
    const artifact = honestArtifact("art-05");
    artifact.player.events[0]!.tick = -1;
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("player stream invalid"))).toBe(true);
  });

  it("ART-05b rejects a negative tick on the truth genesis event", () => {
    const artifact = honestArtifact("art-05b");
    artifact.truth.events[0]!.tick = -1;
    reseal(artifact);

    const reasons = expectRejected(artifact);
    expect(reasons.some((r) => r.includes("truth stream invalid"))).toBe(true);
  });

  it("rejects a dropped CommandIssued/CommandAccepted pair even after the trace is rebuilt to match", () => {
    const artifact = honestArtifact("art-command-drop");
    const victim = artifact.truth.events.find((e) => e.kind === "CommandIssued");
    expect(victim).toBeDefined();
    const commandId = (victim!.payload as { commandId: string }).commandId;
    artifact.truth.events = artifact.truth.events.filter(
      (e) => (e.payload as { commandId?: string }).commandId !== commandId,
    );
    artifact.commandTrace = artifact.commandTrace.filter((c) => c.commandId !== commandId);
    reseal(artifact);

    const result = verifyRunArtifact(artifact, { scenario: blackRiver() });
    expect(result.replayChecked).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("reports honestly that full replay is required when no scenario is supplied", () => {
    const artifact = honestArtifact("art-no-replay");
    const result = verifyRunArtifact(artifact, { requireReplay: true });
    expect(result.replayChecked).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("full verification requires compiled scenario replay"))).toBe(
      true,
    );
  });

  it("M10 P0-02 rejects a resealed player CommandResult rewrite via projection rebuild", () => {
    const artifact = honestArtifact("art-player-forge");
    const playerCommand = artifact.player.events.find((e) => e.kind === "CommandResult");
    expect(playerCommand).toBeDefined();
    const before = structuredClone(playerCommand!.payload) as { state: string };
    (playerCommand!.payload as { state: string; errorCode: string | null; detail: string | null }).state =
      before.state === "accepted" ? "rejected" : "accepted";
    (playerCommand!.payload as { errorCode: string | null }).errorCode = "forged_player_history";
    (playerCommand!.payload as { detail: string | null }).detail = "FORGED";
    reseal(artifact);

    const result = verifyRunArtifact(artifact, { scenario: blackRiver(), requireReplay: true });
    expect(result.ok).toBe(false);
    expect(
      result.reasons.some(
        (r) =>
          r.includes("player CommandResult state") ||
          r.includes("player projection rebuild produced a different playerLogHash"),
      ),
    ).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { parseReplayArtifact, ReplayArtifactParseError, type ReplayArtifact, type ReplayTruthEvent } from "../src/replay/schema";
import { CanonicalJsonDepthError, canonicalJsonReplay, sha256Hex } from "../src/replay/hash";
import { verifyReplayArtifact } from "../src/replay/verify";
import { MAX_NESTING_DEPTH } from "../src/replay/bounds";
import { buildEvidenceProvenance } from "../src/replay/project";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_RAW = readFileSync(join(HERE, "fixtures", "sample-run.artifact.json"), "utf8");

function truthEventHash(
  event: Pick<ReplayTruthEvent, "sessionId" | "sequence" | "tick" | "kind" | "payload" | "previousHash">,
): string {
  return sha256Hex(
    canonicalJsonReplay({
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash: event.previousHash,
    }),
  );
}

function playerEventHash(
  event: Pick<PlayerEventEnvelope, "sessionId" | "sequence" | "tick" | "kind" | "payload" | "previousHash">,
): string {
  return sha256Hex(
    canonicalJsonReplay({
      stream: "player",
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash: event.previousHash,
    }),
  );
}

/** Fully reseals truth + player chains, tips, counts, and outer artifactHash. */
function resealAll(artifact: ReplayArtifact): void {
  let previous = "";
  artifact.truth.events.forEach((event, index) => {
    event.sequence = index;
    event.previousHash = previous;
    event.hash = truthEventHash(event);
    previous = event.hash;
  });
  artifact.eventCount = artifact.truth.events.length;
  artifact.truthLogHash = previous;

  previous = "";
  artifact.player.events.forEach((event, index) => {
    event.sequence = index;
    event.previousHash = previous;
    event.hash = playerEventHash(event);
    previous = event.hash;
  });
  artifact.playerEventCount = artifact.player.events.length;
  artifact.playerLogHash = previous;

  const { artifactHash, ...body } = artifact;
  void artifactHash;
  artifact.artifactHash = sha256Hex(canonicalJsonReplay(body));
}

function deepNest(depth: number): unknown {
  let value: unknown = { leaf: true };
  for (let i = 0; i < depth; i++) {
    value = { nested: value };
  }
  return value;
}

describe("M10.1.1 fail-closed parsing", () => {
  it("rejects EvidenceRecorded with missing evidence before projection", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.player.events.findIndex((e) => e.kind === "EvidenceRecorded");
    artifact.player.events[idx]!.payload = {};
    resealAll(artifact);
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(ReplayArtifactParseError);
    expect(() => buildEvidenceProvenance(artifact)).toThrow();
  });

  it("rejects ClaimUpdated with missing claim fields", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.player.events.findIndex((e) => e.kind === "ClaimUpdated");
    artifact.player.events[idx]!.payload = { claim: { id: "x" }, reason: "updated" };
    resealAll(artifact);
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/ClaimUpdated|invalid_payload/);
  });

  it("rejects SystemStateChanged with invalid payload", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.truth.events.findIndex((e) => e.kind === "SystemStateChanged");
    artifact.truth.events[idx]!.payload = { districts: "nope" };
    resealAll(artifact);
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/SystemStateChanged|invalid_payload/);
  });

  it("rejects fully resealed malformed SystemStateChanged teams and routes before projection", () => {
    for (const mutate of [
      (artifact: ReplayArtifact) => {
        for (const event of artifact.truth.events) {
          if (event.kind === "SystemStateChanged") event.payload.teams = [{}, {}];
        }
      },
      (artifact: ReplayArtifact) => {
        for (const event of artifact.truth.events) {
          if (event.kind === "SystemStateChanged") event.payload.routes = { forged: null };
        }
      },
    ]) {
      const artifact = parseReplayArtifact(FIXTURE_RAW);
      mutate(artifact);
      resealAll(artifact);
      expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/SystemStateChanged\.(teams|routes)/);
    }
  });

  it("rejects nested truth/player values that only satisfy the outer container shape", () => {
    const districtForgery = parseReplayArtifact(FIXTURE_RAW);
    districtForgery.truth.events[0]!.payload.districts = [{}];
    resealAll(districtForgery);
    expect(() => parseReplayArtifact(JSON.stringify(districtForgery))).toThrow(/ScenarioStarted\.districts/);

    const scoreForgery = parseReplayArtifact(FIXTURE_RAW);
    const completed = scoreForgery.truth.events.at(-1)!;
    (completed.payload.finalScore as { breakdown: unknown[] }).breakdown = [{}];
    resealAll(scoreForgery);
    expect(() => parseReplayArtifact(JSON.stringify(scoreForgery))).toThrow(/finalScore\.breakdown/);

    const claimForgery = parseReplayArtifact(FIXTURE_RAW);
    const claimUpdated = claimForgery.player.events.find((event) => event.kind === "ClaimUpdated")!;
    ((claimUpdated.payload as { claim: { evidenceIds: unknown[] } }).claim.evidenceIds) = [{}];
    resealAll(claimForgery);
    expect(() => parseReplayArtifact(JSON.stringify(claimForgery))).toThrow(/evidenceIds/);
  });

  it("rejects TrueIncidentOccurred with incomplete payload", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.truth.events.findIndex((e) => e.kind === "TrueIncidentOccurred");
    artifact.truth.events[idx]!.payload = { incidentId: "only" };
    resealAll(artifact);
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/TrueIncidentOccurred|invalid_payload/);
  });

  it("rejects player payload arrays", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.player.events.findIndex((e) => e.kind === "EvidenceRecorded");
    (artifact.player.events[idx] as { payload: unknown }).payload = [];
    resealAll(artifact);
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/non-array object/);
  });

  it("rejects excessive nested-object depth as a controlled error", () => {
    expect(() => canonicalJsonReplay(deepNest(MAX_NESTING_DEPTH + 2))).toThrow(CanonicalJsonDepthError);
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.player.events.findIndex((e) => e.kind === "EvidenceRecorded");
    const evidence = structuredClone((artifact.player.events[idx]!.payload as { evidence: object }).evidence);
    (artifact.player.events[idx]!.payload as { evidence: unknown }).evidence = {
      ...evidence,
      content: deepNest(MAX_NESTING_DEPTH + 4),
    };
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/nesting|depth|string|invalid_payload/);
  });

  it("rejects negative sequence values", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    artifact.player.events[1]!.sequence = -1;
    expect(() => parseReplayArtifact(JSON.stringify(artifact))).toThrow(/non-negative integer/);
  });
});

describe("M10.1.1 fully resealed semantic gaps", () => {
  it("rejects accepted/rejected CommandResult rewrite", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const playerCommand = artifact.player.events.find((e) => e.kind === "CommandResult")!;
    const before = playerCommand.payload as { state: string };
    (playerCommand.payload as { state: string }).state = before.state === "accepted" ? "rejected" : "accepted";
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.integrityOk).toBe(true);
    expect(result.semanticBindingsOk).toBe(false);
    expect(result.status).toBe("FAIL");
  });

  it("rejects deleting one player CommandResult", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const idx = artifact.player.events.findIndex((e) => e.kind === "CommandResult");
    artifact.player.events.splice(idx, 1);
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("no matching player CommandResult"))).toBe(true);
  });

  it("rejects deleting every player CommandResult", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    artifact.player.events = artifact.player.events.filter((e) => e.kind !== "CommandResult");
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("no matching player CommandResult"))).toBe(true);
  });

  it("rejects a duplicated player CommandResult after rechain", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const first = artifact.player.events.find((e) => e.kind === "CommandResult")!;
    const clone = structuredClone(first);
    const insertAt = artifact.player.events.findIndex((e) => e === first) + 1;
    artifact.player.events.splice(insertAt, 0, clone);
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("duplicate player CommandResult"))).toBe(true);
  });

  it("rejects a player stream moved to another session ID", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    for (const event of artifact.player.events) {
      event.sessionId = "forged-session";
    }
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("sessionId does not match identity"))).toBe(true);
  });

  it("rejects a forged active-incident summary", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    artifact.activeIncidents = [...artifact.activeIncidents, "forged-incident"];
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("activeIncidents"))).toBe(true);
  });

  it("rejects forged RunCompleted claim/evidence counts", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const terminal = artifact.player.events[artifact.player.events.length - 1]!;
    expect(terminal.kind).toBe("RunCompleted");
    (terminal.payload as { claimCount: number }).claimCount += 99;
    (terminal.payload as { evidenceCount: number }).evidenceCount += 99;
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("claimCount") || r.includes("evidenceCount"))).toBe(true);
  });

  it("marks publicActionLedger / scenario digest / protocol as NOT_CHECKED even after resealed forgeries", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    artifact.publicActionLedger = [];
    artifact.identity.scenarioDigest = "a".repeat(64);
    artifact.identity.engineProtocolVersion = 999;
    resealAll(artifact);
    const result = verifyReplayArtifact(artifact);
    // May FAIL for other semantic reasons if ledger emptiness conflicts — scopes must stay NOT_CHECKED.
    expect(result.scopes.publicActionLedger).toBe("NOT_CHECKED");
    expect(result.scopes.scenarioContentDigest).toBe("NOT_CHECKED");
    expect(result.scopes.engineProtocolCompatibility).toBe("NOT_CHECKED");
    expect(result.scopes.stateDigest).toBe("NOT_CHECKED");
    expect(result.scopes.truthReplay).toBe("NOT_CHECKED");
    expect(result.scopes.playerReplay).toBe("NOT_CHECKED");
    expect(result.scopes.authenticity).toBe("NOT_CHECKED");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReplayArtifact } from "../src/replay/schema";
import { deriveAssessmentTrace, deriveCommandTrace, verifyReplayArtifact, verifyPlayerChain, verifyTruthChain } from "../src/replay/verify";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_RAW = readFileSync(join(HERE, "fixtures", "sample-run.artifact.json"), "utf8");

function freshArtifact() {
  return parseReplayArtifact(FIXTURE_RAW);
}

describe("replay/verify verifyReplayArtifact", () => {
  it("independently verifies a genuine artifact with no reasons for rejection", () => {
    const artifact = freshArtifact();
    const result = verifyReplayArtifact(artifact);
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("PARTIAL");
    expect(result.integrityOk).toBe(true);
    expect(result.semanticBindingsOk).toBe(true);
    expect(result.truthReplayChecked).toBe(false);
    expect(result.playerReplayChecked).toBe(false);
    expect(result.scopes.truthReplay).toBe("NOT_CHECKED");
    expect(result.scopes.publicActionLedger).toBe("NOT_CHECKED");
    expect(result.scopes.scenarioContentDigest).toBe("NOT_CHECKED");
  });

  it("re-derives the command trace from the truth log and it matches exactly (terminal equality)", () => {
    const artifact = freshArtifact();
    const rebuilt = deriveCommandTrace(artifact.truth.events);
    expect(rebuilt).toEqual(artifact.commandTrace);
  });

  it("re-derives the assessment trace from the player log and it matches exactly", () => {
    const artifact = freshArtifact();
    const rebuilt = deriveAssessmentTrace(artifact.player.events);
    expect(rebuilt).toEqual(artifact.assessmentTrace);
  });

  it("rejects a tampered truth event payload", () => {
    const artifact = freshArtifact();
    const idx = artifact.truth.events.findIndex((e) => e.kind === "ActionApplied");
    artifact.truth.events[idx]!.payload = { ...artifact.truth.events[idx]!.payload, tampered: true };
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("truth stream invalid") || r.includes("artifactHash"))).toBe(true);
  });

  it("rejects a tampered player event payload (e.g. a forged evidence report)", () => {
    const artifact = freshArtifact();
    const idx = artifact.player.events.findIndex((e) => e.kind === "EvidenceRecorded");
    expect(idx).toBeGreaterThanOrEqual(0);
    artifact.player.events[idx]!.payload = { ...(artifact.player.events[idx]!.payload as object), tampered: true };
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
  });

  it("rejects a tampered score total that leaves the event logs untouched", () => {
    const artifact = freshArtifact();
    const tampered = { ...artifact, scoreTotal: artifact.scoreTotal + 999 };
    const result = verifyReplayArtifact(tampered);
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("artifactHash mismatch");
  });

  it("rejects a tampered commandTrace outcome", () => {
    const artifact = freshArtifact();
    artifact.commandTrace[0]!.outcome = artifact.commandTrace[0]!.outcome === "accepted" ? "rejected" : "accepted";
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("commandTrace") || r.includes("artifactHash"))).toBe(true);
  });

  it("rejects a broken hash-chain link even with everything else intact", () => {
    const artifact = freshArtifact();
    artifact.truth.events[10]!.previousHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const chain = verifyTruthChain(artifact.truth.events, artifact.truthLogHash);
    expect(chain.validChain).toBe(false);
    expect(chain.reason).toBe("previous_hash_mismatch");
  });

  it("rejects a player chain with a sequence gap", () => {
    const artifact = freshArtifact();
    const events = artifact.player.events.slice();
    events.splice(2, 1);
    const chain = verifyPlayerChain(events);
    expect(chain.validChain).toBe(false);
    expect(chain.reason).toBe("sequence_gap");
  });
});

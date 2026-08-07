import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { parseReplayArtifact, type ReplayArtifact } from "../src/replay/schema";
import { canonicalJsonReplay, sha256Hex } from "../src/replay/hash";
import { verifyReplayArtifact } from "../src/replay/verify";
import { buildMarkdownReport } from "../src/replay/report";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_RAW = readFileSync(join(HERE, "fixtures", "sample-run.artifact.json"), "utf8");
const MINIMAL_FORGERY_RAW = readFileSync(join(HERE, "fixtures", "minimal-semantic-forgery.artifact.json"), "utf8");

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

/** Recomputes every attacker-controlled player hash + artifactHash (M10.1 audit). */
function resealPlayerAndArtifact(artifact: ReplayArtifact): void {
  let previousHash = "";
  artifact.player.events.forEach((event, index) => {
    event.sequence = index;
    event.previousHash = previousHash;
    event.hash = playerEventHash(event);
    previousHash = event.hash;
  });
  artifact.playerEventCount = artifact.player.events.length;
  artifact.playerLogHash = previousHash;
  const { artifactHash, ...body } = artifact;
  void artifactHash;
  artifact.artifactHash = sha256Hex(canonicalJsonReplay(body));
}

describe("M10.1 browser verifier honesty", () => {
  it("honest sample is PARTIAL (integrity+semantics), never unqualified full PASS", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const result = verifyReplayArtifact(artifact);
    expect(result.status).toBe("PARTIAL");
    expect(result.integrityOk).toBe(true);
    expect(result.semanticBindingsOk).toBe(true);
    expect(result.truthReplayChecked).toBe(false);
    expect(result.playerReplayChecked).toBe(false);
    expect(result.authenticity).toBe("none");
    expect(result.stateDigestStatus).toBe("NOT_CHECKED");

    const report = buildMarkdownReport(artifact, result, []);
    expect(report).toMatch(/Browser verification status: \*\*PARTIAL\*\*/);
    expect(report).toMatch(/Truth replay: \*\*NOT_CHECKED\*\*/);
    expect(report).toMatch(/Player projection replay: \*\*NOT_CHECKED\*\*/);
    expect(report).toMatch(/publicActionLedger: \*\*NOT_CHECKED\*\*/);
    expect(report).not.toMatch(/Independent client-side verification: \*\*PASS\*\*/);
    expect(report).toMatch(/null-city-run verify/);
  });

  it("rejects a fully resealed player CommandResult rewrite (audit counterexample)", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    const playerCommand = artifact.player.events.find((e) => e.kind === "CommandResult");
    expect(playerCommand).toBeDefined();
    const before = structuredClone(playerCommand!.payload) as { state: string };
    (playerCommand!.payload as { state: string }).state = before.state === "accepted" ? "rejected" : "accepted";
    (playerCommand!.payload as { errorCode: string | null }).errorCode = "forged_player_history";
    (playerCommand!.payload as { detail: string | null }).detail = "FORGED";
    resealPlayerAndArtifact(artifact);

    // Hash envelope is self-consistent after reseal — only semantics catch it.
    const result = verifyReplayArtifact(artifact);
    expect(result.integrityOk).toBe(true);
    expect(result.semanticBindingsOk).toBe(false);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("CommandResult state"))).toBe(true);
    expect(result.truthReplayChecked).toBe(false);
    expect(result.playerReplayChecked).toBe(false);

    const report = buildMarkdownReport(artifact, result, []);
    expect(report).toMatch(/Browser verification status: \*\*FAIL\*\*/);
    expect(report).not.toMatch(/independent verify: PASS/i);
  });

  it("rejects the minimal semantic forgery fixture after parse", () => {
    // Fixture may fail parse or fail verify; either is acceptable rejection.
    try {
      const artifact = parseReplayArtifact(MINIMAL_FORGERY_RAW);
      const result = verifyReplayArtifact(artifact);
      expect(result.status).toBe("FAIL");
      expect(result.semanticBindingsOk || result.integrityOk).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});

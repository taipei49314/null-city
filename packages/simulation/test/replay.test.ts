import { describe, expect, it } from "vitest";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";
import { replayEventLog, replayResult } from "../src/replay.js";

describe("replay equivalence", () => {
  it("replaying the event log from empty reproduces the original run byte-for-byte", () => {
    const original = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "replay-orig" });
    runScript(original, goldenScript());
    original.runToEnd();

    const replay = replayEventLog(original.eventLog, blackRiver(), "replay-orig", 49314);

    expect(replay.eventLogHash, "event log hash must match").toBe(original.eventLogHash);
    expect(replay.finalStateDigest(), "final state digest must match").toBe(original.finalStateDigest());
    expect(replay.worldState.score.total).toBe(original.worldState.score.total);
    expect(replay.eventLog).toEqual(original.eventLog);
  });

  it("replayResult returns digest, hash and score", () => {
    const original = new SimulationEngine({ scenario: blackRiver(), seed: 99, sessionId: "replay-two" });
    runScript(original, goldenScript());
    original.runToEnd();
    const result = replayResult(original.eventLog, blackRiver(), "replay-two", 99);
    expect(result.eventLogHash).toBe(original.eventLogHash);
    expect(result.finalStateDigest).toBe(original.finalStateDigest());
    expect(result.score).toBe(original.worldState.score.total);
  });

  it("replay of a do-nothing run also matches", () => {
    const original = new SimulationEngine({ scenario: blackRiver(), seed: 555, sessionId: "replay-none" });
    original.runToEnd();
    const replay = replayEventLog(original.eventLog, blackRiver(), "replay-none", 555);
    expect(replay.eventLogHash).toBe(original.eventLogHash);
    expect(replay.finalStateDigest()).toBe(original.finalStateDigest());
  });
});
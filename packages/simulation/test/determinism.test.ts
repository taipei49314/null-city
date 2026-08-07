import { describe, expect, it } from "vitest";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

function run(seed: number): SimulationEngine {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed, sessionId: `fixed-session-${seed}` });
  runScript(engine, goldenScript());
  engine.runToEnd();
  return engine;
}

describe("determinism", () => {
  it("same seed + same commands produce identical event log hash, state and score", () => {
    const a = run(49314);
    const b = run(49314);
    expect(a.eventLogHash).toBe(b.eventLogHash);
    expect(a.finalStateDigest()).toBe(b.finalStateDigest());
    expect(a.worldState.score.total).toBe(b.worldState.score.total);
    expect(a.worldState.districts).toEqual(b.worldState.districts);
    expect(a.deliveredObservations.map((o) => o.observationId)).toEqual(
      b.deliveredObservations.map((o) => o.observationId),
    );
  });

  it("different seeds diverge in at least one reasonable random outcome", () => {
    const a = run(49314);
    const b = run(49315);
    expect(a.eventLogHash).not.toBe(b.eventLogHash);
    const aCorruptions = a.eventLog.filter((e) => e.kind === "ObservationCorrupted").length;
    const bCorruptions = b.eventLog.filter((e) => e.kind === "ObservationCorrupted").length;
    const aLoss = a.eventLog.filter((e) => e.kind === "ObservationLost").length;
    const bLoss = b.eventLog.filter((e) => e.kind === "ObservationLost").length;
    // corruption is driven by the seeded rng, so at least one of these must differ
    expect(aCorruptions !== bCorruptions || aLoss !== bLoss).toBe(true);
  });

  it("score breakdown always reconciles with the total", () => {
    const engine = run(49314);
    const sum = engine.worldState.score.breakdown.reduce((acc, b) => acc + b.delta, 0);
    expect(sum).toBeCloseTo(engine.worldState.score.total, 1);
  });
});
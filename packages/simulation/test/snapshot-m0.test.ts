import { describe, expect, it } from "vitest";
import { blackRiver, failureScript, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine, scenarioDigest } from "../src/index.js";

function runToTick(tick: number, sessionId = "snap-m0", script = goldenScript()): SimulationEngine {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId });
  runScript(
    engine,
    script.filter((command) => command.atTick <= tick),
  );
  while (engine.currentTick < tick && engine.step()) {
    // advance
  }
  return engine;
}

describe("snapshot M0 invariants", () => {
  it("snapshot world is detached from live engine mutation", () => {
    const engine = runToTick(50);
    const snap = engine.snapshot();
    expect(snap.tick).toBe(50);
    const powerBefore = snap.world.districts.industrial!.power;
    while (engine.currentTick < 120 && engine.step()) {
      // mutate live world
    }
    expect(engine.currentTick).toBeGreaterThan(50);
    expect(snap.tick).toBe(50);
    expect(snap.world.districts.industrial!.power).toBe(powerBefore);
  });

  it("resume after chained incident matches uninterrupted run", () => {
    // Neglect path produces chained incidents; golden path often prevents them.
    const direct = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "chain" });
    runScript(direct, failureScript());
    let chainTick: number | null = null;
    while (direct.currentTick < 540 && direct.step()) {
      if (direct.eventLog.some((event) => event.kind === "IncidentChained")) {
        chainTick = direct.currentTick;
        break;
      }
    }
    expect(chainTick).not.toBeNull();

    const snapshotEngine = runToTick(chainTick!, "chain", failureScript());
    expect(snapshotEngine.eventLog.some((event) => event.kind === "IncidentChained")).toBe(true);
    const snapshot = snapshotEngine.snapshot();
    expect(snapshot.chainedCount).toBeGreaterThan(0);

    const resumed = new SimulationEngine({
      scenario: blackRiver(),
      seed: 49314,
      sessionId: "chain",
      resume: snapshot,
    });
    resumed.runToEnd();
    direct.runToEnd();
    expect(resumed.eventLogHash).toBe(direct.eventLogHash);
    expect(resumed.finalStateDigest()).toBe(direct.finalStateDigest());
    expect(resumed.worldState.score.total).toBe(direct.worldState.score.total);
  });

  it.each([
    { label: "session", patch: { sessionId: "other" } },
    { label: "seed", patch: { seed: 1 } },
    { label: "scenarioId", patch: { scenarioId: "other-scenario" } },
    { label: "scenarioDigest", patch: { scenarioDigest: "0".repeat(64) } },
    { label: "version", patch: { version: 2 as 1 } },
    { label: "protocolVersion", patch: { protocolVersion: 2 as 1 } },
  ])("rejects resume mismatch on $label", ({ patch }) => {
    const snapshot = runToTick(40).snapshot();
    expect(() =>
      new SimulationEngine({
        scenario: blackRiver(),
        seed: 49314,
        sessionId: "snap-m0",
        resume: { ...snapshot, ...patch },
      }),
    ).toThrow(/mismatch|unsupported/i);
  });

  it("binds scenarioDigest to the compiled scenario", () => {
    const snapshot = runToTick(10).snapshot();
    expect(snapshot.scenarioDigest).toBe(scenarioDigest(blackRiver()));
  });

  it("snapshot/resume matrix across lifecycle ticks", () => {
    const ticks = [12, 60, 120, 300, 520];
    for (const tick of ticks) {
      const snapshot = runToTick(tick, `matrix-${tick}`).snapshot();
      const resumed = new SimulationEngine({
        scenario: blackRiver(),
        seed: 49314,
        sessionId: `matrix-${tick}`,
        resume: snapshot,
      });
      const direct = runToTick(tick, `matrix-${tick}`);
      const rest = goldenScript().filter((command) => command.atTick > tick);
      runScript(resumed, rest);
      runScript(direct, rest);
      resumed.runToEnd();
      direct.runToEnd();
      expect(resumed.eventLogHash, `tick ${tick}`).toBe(direct.eventLogHash);
      expect(resumed.worldState.score.total, `tick ${tick}`).toBe(direct.worldState.score.total);
    }
  });
});

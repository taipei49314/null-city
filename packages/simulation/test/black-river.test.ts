import { describe, expect, it } from "vitest";
import { blackRiver, failureScript, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

describe("BLACK RIVER end-to-end", () => {
  describe("golden path (defensible play)", () => {
    it("resolves the initial incidents and prevents chained failures", () => {
      const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "golden" });
      runScript(engine, goldenScript());
      engine.runToEnd();

      expect(engine.sessionId).toBe("golden");
      expect(engine.worldState.score.total, "golden play scores positive").toBeGreaterThan(0);
      expect(engine.result().handledIncidents).toEqual(
        expect.arrayContaining(["substation_fault", "hospital_power"]),
      );
      expect(engine.result().activeIncidents).not.toContain("pumping_station");
      expect(engine.result().activeIncidents).not.toContain("metro_flood");
      const chained = engine.eventLog.filter((e) => e.kind === "IncidentChained");
      expect(chained, "no chained failures in golden play").toHaveLength(0);
      expect(engine.result().deliveredObservationCount).toBeGreaterThan(0);
    });

    it("breakdown reconciles with the total score", () => {
      const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "golden-score" });
      runScript(engine, goldenScript());
      engine.runToEnd();
      const sum = engine.worldState.score.breakdown.reduce((acc, b) => acc + b.delta, 0);
      expect(sum).toBeCloseTo(engine.worldState.score.total, 1);
    });

    it("produces a plausible event sequence (start then complete)", () => {
      const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "golden-seq" });
      runScript(engine, goldenScript());
      engine.runToEnd();
      expect(engine.eventLog[0]!.kind).toBe("ScenarioStarted");
      expect(engine.eventLog[engine.eventLog.length - 1]!.kind).toBe("ScenarioCompleted");
      const ticks = engine.eventLog.map((e) => e.tick);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(540);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    });
  });

  describe("failure path (neglect)", () => {
    function neglect() {
      const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "neglect" });
      runScript(engine, failureScript());
      engine.runToEnd();
      return engine;
    }

    it("leaves incidents unresolved and triggers the chained cascade", () => {
      const engine = neglect();
      const active = engine.result().activeIncidents;
      expect(active).toContain("substation_fault");
      expect(active).toContain("hospital_power");
      expect(active).toContain("pumping_station");
      expect(active).toContain("metro_flood");
      expect(engine.eventLog.filter((e) => e.kind === "IncidentChained").length).toBeGreaterThanOrEqual(2);
    });

    it("slips the city into a negative score", () => {
      const engine = neglect();
      expect(engine.worldState.score.total).toBeLessThan(0);
    });

    it("has strictly worse infrastructure and population risk than golden play", () => {
      const golden = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "cmp-golden" });
      runScript(golden, goldenScript());
      golden.runToEnd();
      const bad = neglect();
      const infra = (d: typeof golden.worldState.districts) =>
        Object.values(d).reduce(
          (acc, x) => acc + (x.power + x.communications + x.water + x.traffic + x.medicalCapacity) / 5,
          0,
        );
      expect(infra(bad.worldState.districts)).toBeLessThan(infra(golden.worldState.districts));
      const risk = (d: typeof golden.worldState.districts) => Object.values(d).reduce((acc, x) => acc + x.populationRisk, 0);
      expect(risk(bad.worldState.districts)).toBeGreaterThan(risk(golden.worldState.districts));
    });
  });
});
import { describe, expect, it } from "vitest";
import { validateScenario, parseScenario, scenarioSchema, stripCompiledFields } from "../src/index.js";

const valid = {
  schemaVersion: 1,
  id: "t",
  name: "Test",
  tickDurationSeconds: 10,
  totalTicks: 100,
  districts: [
    {
      id: "central",
      power: 100,
      communications: 100,
      water: 100,
      traffic: 100,
      medicalCapacity: 100,
      hazardLevel: 0,
      populationRisk: 0,
    },
  ],
  teams: [],
  routes: [],
  resources: { backupGenerators: 1, advisoryUses: 1 },
  incidents: [],
  effects: [],
  sources: [],
  observations: [],
};

describe("scenarioSchema", () => {
  it("accepts a minimal valid scenario", () => {
    expect(() => validateScenario(valid)).not.toThrow();
  });

  it("rejects negative values", () => {
    expect(() => validateScenario({ ...valid, districts: [{ ...valid.districts[0], power: -1 }] })).toThrow();
  });

  it("rejects values above 100", () => {
    expect(() => validateScenario({ ...valid, districts: [{ ...valid.districts[0], water: 101 }] })).toThrow();
  });

  it("rejects non-integer totalTicks", () => {
    expect(() => validateScenario({ ...valid, totalTicks: 10.5 })).toThrow();
  });

  it("rejects unknown top-level fields", () => {
    expect(() => validateScenario({ ...valid, sneaky: true })).toThrow();
  });

  it("rejects non-string scenario id", () => {
    expect(() => validateScenario({ ...valid, id: 42 })).toThrow();
  });

  it("parses from JSON text and round-trips", () => {
    const parsed = parseScenario(JSON.stringify(valid));
    expect(parsed.id).toBe("t");
    expect(scenarioSchema.safeParse(stripCompiledFields(parsed)).success).toBe(true);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseScenario("{oops")).toThrow();
  });
});
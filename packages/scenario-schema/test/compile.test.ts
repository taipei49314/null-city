import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileScenario,
  ScenarioCompileError,
  parseScenario,
  validateScenario,
  scenarioSchema,
  stripCompiledFields,
} from "../src/index.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const blackRiverJson = readFileSync(join(ROOT, "scenarios/black-river.json"), "utf8");
const blackRiverRaw = () => scenarioSchema.parse(JSON.parse(blackRiverJson));

describe("scenario compiler", () => {
  it("compiles Black River with a stable digest", () => {
    const a = validateScenario(blackRiverRaw());
    const b = validateScenario(blackRiverRaw());
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a.format).toBe("nullcity-scenario");
    expect(a.indexes.incidentIds).toContain("substation_fault");
  });

  it("rejects duplicate ids", () => {
    const raw = blackRiverRaw();
    raw.teams.push({ ...raw.teams[0]! });
    expect(() => compileScenario(raw)).toThrow(ScenarioCompileError);
  });

  it("rejects unknown observation references", () => {
    const raw = blackRiverRaw();
    raw.observations[0]!.incidentId = "nope";
    expect(() => compileScenario(raw)).toThrow(/unknown incident/);
  });

  it("rejects chain cycles", () => {
    const raw = blackRiverRaw();
    const a = raw.incidents[0]!;
    const b = raw.incidents[1]!;
    a.chainTrigger = {
      sourceIncidentId: b.id,
      attribute: "power",
      below: 50,
      forTicks: 3,
    };
    b.chainTrigger = {
      sourceIncidentId: a.id,
      attribute: "power",
      below: 50,
      forTicks: 3,
    };
    expect(() => compileScenario(raw)).toThrow(/cycle/);
  });

  it("rejects corruption probability sums above 1", () => {
    const raw = blackRiverRaw();
    const obs = raw.observations.find((o) => (o.corruption?.length ?? 0) > 0) ?? raw.observations[0]!;
    obs.corruption = [
      { probability: 0.7, type: "exaggerated", text: "a", false: true },
      { probability: 0.7, type: "understated", text: "b", false: true },
    ];
    expect(() => compileScenario(raw)).toThrow(/corruption probability/);
  });

  it("parseScenario compiles from JSON text", () => {
    const compiled = parseScenario(blackRiverJson);
    expect(compiled.digest).toHaveLength(64);
    expect(scenarioSchema.safeParse(stripCompiledFields(compiled)).success).toBe(true);
  });

  it("allows chain-only incidents with sentinel atTick", () => {
    const raw = blackRiverRaw();
    const chained = raw.incidents.find((i) => i.id === "pumping_station")!;
    expect(chained.atTick).toBeGreaterThan(raw.totalTicks);
    expect(() => compileScenario(raw)).not.toThrow();
  });
});

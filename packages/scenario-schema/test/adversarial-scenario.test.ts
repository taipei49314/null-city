import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  assertScenarioSize,
  compileScenario,
  parseScenario,
  ScenarioCompileError,
  scenarioSchema,
} from "../src/index.js";

/**
 * M8: scenario reference, cycle and probability abuse beyond the cases
 * `compile.test.ts` already covers.
 *
 * `compile.test.ts` proves a two-incident cycle is caught. These add the
 * shapes a two-node check can miss — a self-chain and a longer ring — plus the
 * exact probability boundary and the size ceiling, which is the only guard
 * standing between a hostile scenario file and the parser.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const blackRiverJson = readFileSync(join(ROOT, "scenarios/black-river.json"), "utf8");
const raw = () => scenarioSchema.parse(JSON.parse(blackRiverJson));

const chainTrigger = (sourceIncidentId: string) => ({
  sourceIncidentId,
  attribute: "power" as const,
  below: 50,
  forTicks: 3,
});

describe("chain-trigger cycle detection", () => {
  it("rejects an incident that chains from itself", () => {
    const scenario = raw();
    const incident = scenario.incidents[0]!;
    incident.chainTrigger = chainTrigger(incident.id);
    expect(() => compileScenario(scenario)).toThrow(/cycle/);
  });

  it("rejects a three-incident ring", () => {
    const scenario = raw();
    const [a, b, c] = [scenario.incidents[0]!, scenario.incidents[1]!, scenario.incidents[2]!];
    expect(c).toBeDefined();
    a.chainTrigger = chainTrigger(c.id);
    b.chainTrigger = chainTrigger(a.id);
    c.chainTrigger = chainTrigger(b.id);
    expect(() => compileScenario(scenario)).toThrow(/cycle/);
  });

  it("accepts a linear chain of the same depth (negative control)", () => {
    const scenario = raw();
    const [a, b, c] = [scenario.incidents[0]!, scenario.incidents[1]!, scenario.incidents[2]!];
    b.chainTrigger = chainTrigger(a.id);
    c.chainTrigger = chainTrigger(b.id);
    expect(() => compileScenario(scenario)).not.toThrow();
  });

  it("rejects a chain trigger naming an incident that does not exist", () => {
    const scenario = raw();
    scenario.incidents[0]!.chainTrigger = chainTrigger("ghost-incident");
    expect(() => compileScenario(scenario)).toThrow(/unknown source incident/);
  });
});

describe("corruption probability boundaries", () => {
  it("accepts a corruption set summing to exactly 1", () => {
    const scenario = raw();
    scenario.observations[0]!.corruption = [
      { probability: 0.5, type: "exaggerated", text: "a", false: true },
      { probability: 0.5, type: "understated", text: "b", false: true },
    ];
    expect(() => compileScenario(scenario)).not.toThrow();
  });

  it("rejects a corruption set summing just above 1", () => {
    const scenario = raw();
    scenario.observations[0]!.corruption = [
      { probability: 0.5, type: "exaggerated", text: "a", false: true },
      { probability: 0.5002, type: "understated", text: "b", false: true },
    ];
    expect(() => compileScenario(scenario)).toThrow(/corruption probability/);
  });

  it("rejects a probability outside [0,1] at the schema layer", () => {
    const scenario = JSON.parse(blackRiverJson);
    scenario.observations[0].corruption = [
      { probability: 1.5, type: "exaggerated", text: "a", false: true },
    ];
    expect(() => scenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects a negative probability at the schema layer", () => {
    const scenario = JSON.parse(blackRiverJson);
    scenario.observations[0].corruption = [
      { probability: -0.2, type: "exaggerated", text: "a", false: true },
    ];
    expect(() => scenarioSchema.parse(scenario)).toThrow();
  });
});

describe("hostile scenario input", () => {
  it("rejects an oversized scenario file before parsing", () => {
    const oversized = JSON.stringify({ padding: "x".repeat(4 * 1024 * 1024) });
    expect(() => assertScenarioSize(oversized)).toThrow(/exceeds/);
  });

  it("rejects a self-loop route", () => {
    const scenario = raw();
    scenario.routes[0]!.to = scenario.routes[0]!.from;
    expect(() => compileScenario(scenario)).toThrow(ScenarioCompileError);
  });

  it("rejects a route referencing an unknown district", () => {
    const scenario = raw();
    scenario.routes[0]!.to = "atlantis" as never;
    expect(() => compileScenario(scenario)).toThrow(/unknown district/);
  });

  it("rejects a non-positive route travel time at the schema layer", () => {
    const scenario = JSON.parse(blackRiverJson);
    scenario.routes[0].travelTicks = 0;
    expect(() => scenarioSchema.parse(scenario)).toThrow();
    scenario.routes[0].travelTicks = -5;
    expect(() => scenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects a scenario whose JSON is an array rather than an object", () => {
    expect(() => parseScenario("[]")).toThrow();
  });
});

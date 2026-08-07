import { describe, expect, it } from "vitest";
import { blackRiver } from "@null-city/test-fixtures";
import { validateScenario, parseScenario, assertScenarioSize, type Scenario } from "@null-city/scenario-schema";

/**
 * A compiled scenario is deep-frozen, so a variant has to be built from a
 * mutable copy rather than by writing through the compiled value.
 */
const variant = (): Scenario => structuredClone(blackRiver()) as Scenario;

describe("scenario validation", () => {
  it("accepts the Black River scenario", () => {
    expect(() => validateScenario(blackRiver())).not.toThrow();
  });

  it("returns a deep-frozen compiled scenario", () => {
    const scenario = blackRiver();
    expect(Object.isFrozen(scenario)).toBe(true);
    expect(Object.isFrozen(scenario.districts)).toBe(true);
    expect(Object.isFrozen(scenario.districts[0])).toBe(true);
    // The digest is only meaningful while the contents it covers cannot move.
    expect(() => {
      (scenario.districts[0] as { power: number }).power = 1;
    }).toThrow(TypeError);
  });

  it("rejects a district with an out-of-range value", () => {
    const s = variant();
    s.districts[0]!.power = 150;
    expect(() => validateScenario(s)).toThrow();
  });

  it("rejects an unknown team type", () => {
    const s = variant();
    s.teams[0]!.type = "ghost" as never;
    expect(() => validateScenario(s)).toThrow();
  });

  it("rejects a route referencing an unknown district", () => {
    const s = variant();
    s.routes[0]!.from = "nowhere" as never;
    expect(() => validateScenario(s)).toThrow();
  });

  it("rejects unknown attribute in effects", () => {
    const s = variant();
    s.effects[0]!.attribute = "magic" as never;
    expect(() => validateScenario(s)).toThrow();
  });

  it("rejects unknown severity in advisories via strict object checking", () => {
    const s = blackRiver();
    const bad = JSON.parse(
      JSON.stringify({ ...s, districts: s.districts, extraTopLevelField: true }),
    );
    expect(() => validateScenario(bad)).toThrow();
  });

  it("parseScenario parses raw JSON text", () => {
    const json = JSON.stringify(blackRiver());
    const parsed = parseScenario(json);
    expect(parsed.id).toBe("black-river");
  });

  it("assertScenarioSize rejects oversized files", () => {
    const huge = JSON.stringify({ data: "x".repeat(1_100_000) });
    expect(() => assertScenarioSize(huge)).toThrow();
    expect(() => assertScenarioSize(JSON.stringify(blackRiver()))).not.toThrow();
  });
});
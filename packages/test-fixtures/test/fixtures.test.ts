import { describe, expect, it } from "vitest";
import {
  SCENARIO_IDS,
  blackRiver,
  failureScript,
  glassHarbor,
  glassHarborGoldenScript,
  goldenScript,
  goldenScriptFor,
  loadScenario,
  mirrorDistrict,
  redLedger,
  signalZero,
  signalZeroGoldenScript,
} from "../src/index.js";

describe("test fixtures", () => {
  it("loads the Black River scenario from disk", () => {
    const scenario = blackRiver();
    expect(scenario.id).toBe("black-river");
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.teams).toHaveLength(8);
    expect(scenario.routes).toHaveLength(7);
    expect(scenario.incidents).toHaveLength(4);
  });

  it("loads the Glass Harbor scenario from disk", () => {
    const scenario = glassHarbor();
    expect(scenario.id).toBe("glass-harbor");
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.teams).toHaveLength(7);
    expect(scenario.incidents).toHaveLength(3);
    expect(scenario.metadata?.difficulty).toBe("standard");
  });

  it("loads the Signal Zero scenario from disk", () => {
    const scenario = signalZero();
    expect(scenario.id).toBe("signal-zero");
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.teams).toHaveLength(7);
    expect(scenario.incidents).toHaveLength(3);
    expect(scenario.metadata?.difficulty).toBe("advanced");
  });

  it("loads the Mirror District scenario from disk", () => {
    const scenario = mirrorDistrict();
    expect(scenario.id).toBe("mirror-district");
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.teams).toHaveLength(7);
    expect(scenario.incidents).toHaveLength(4);
    expect(scenario.metadata?.tags).toContain("twin-districts");
  });

  it("loads the Red Ledger scenario from disk", () => {
    const scenario = redLedger();
    expect(scenario.id).toBe("red-ledger");
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.teams).toHaveLength(8);
    expect(scenario.incidents).toHaveLength(4);
    expect(scenario.resources.advisoryUses).toBe(4);
    expect(scenario.metadata?.tags).toContain("ghost-census");
  });

  it("loadScenario rejects unsafe names", () => {
    expect(() => loadScenario("../../etc/passwd")).toThrow();
    expect(() => loadScenario("..")).toThrow();
  });

  it("golden script covers the major command types", () => {
    const commands = goldenScript();
    const names = new Set(commands.map((c) => c.commandName));
    expect(names.has("DISPATCH_TEAM")).toBe(true);
    expect(names.has("PRIORITIZE_COMMUNICATION")).toBe(true);
    expect(names.has("ACTIVATE_BACKUP_GENERATOR")).toBe(true);
    expect(names.has("REQUEST_VERIFICATION")).toBe(true);
  });

  it("glass harbor golden script covers the major command types", () => {
    const commands = glassHarborGoldenScript();
    const names = new Set(commands.map((c) => c.commandName));
    expect(names.has("DISPATCH_TEAM")).toBe(true);
    expect(names.has("PRIORITIZE_COMMUNICATION")).toBe(true);
    expect(names.has("REQUEST_VERIFICATION")).toBe(true);
  });

  it("signal zero golden script covers the major command types", () => {
    const commands = signalZeroGoldenScript();
    const names = new Set(commands.map((c) => c.commandName));
    expect(names.has("DISPATCH_TEAM")).toBe(true);
    expect(names.has("PRIORITIZE_COMMUNICATION")).toBe(true);
    expect(names.has("ACTIVATE_BACKUP_GENERATOR")).toBe(true);
    expect(names.has("REQUEST_VERIFICATION")).toBe(true);
  });

  it("goldenScriptFor dispatches to the right script per scenario id", () => {
    expect(SCENARIO_IDS).toEqual([
      "black-river",
      "glass-harbor",
      "signal-zero",
      "mirror-district",
      "red-ledger",
    ]);
    expect(goldenScriptFor("black-river")).toEqual(goldenScript());
    expect(goldenScriptFor("glass-harbor")).toEqual(glassHarborGoldenScript());
    expect(goldenScriptFor("signal-zero")).toEqual(signalZeroGoldenScript());
    expect(goldenScriptFor("mirror-district")[0]!.commandName).toBe("REQUEST_VERIFICATION");
    expect(goldenScriptFor("red-ledger").some((c) => c.commandName === "ACTIVATE_BACKUP_GENERATOR")).toBe(true);
  });

  it("failure script is empty", () => {
    expect(failureScript()).toEqual([]);
  });
});
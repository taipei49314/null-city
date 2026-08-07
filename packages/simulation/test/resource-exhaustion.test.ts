import { describe, expect, it } from "vitest";
import { blackRiver } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

describe("resource exhaustion", () => {
  it("rejects backup activation when none remain", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "res-1" });
    engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "central" }, "r1a");
    engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "riverside" }, "r1b");
    engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "north" }, "r1c");
    const fourth = engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "medical" }, "r1d");
    expect(engine.worldState.resources.backupGenerators).toBe(0);
    expect(fourth.state).toBe("rejected");
    expect(fourth.validation.errorCode).toBe("no_backup_generators");
  });

  it("rejects public advisories once the budget is spent", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "res-2" });
    engine.submitCommand("ISSUE_PUBLIC_ADVISORY", { district: "central", text: "a", severity: "info" }, "r2a");
    engine.submitCommand("ISSUE_PUBLIC_ADVISORY", { district: "north", text: "b", severity: "info" }, "r2b");
    engine.submitCommand("ISSUE_PUBLIC_ADVISORY", { district: "riverside", text: "c", severity: "info" }, "r2c");
    const fourth = engine.submitCommand("ISSUE_PUBLIC_ADVISORY", { district: "medical", text: "d", severity: "info" }, "r2d");
    expect(engine.worldState.resources.advisoryUses).toBe(0);
    expect(fourth.state).toBe("rejected");
    expect(fourth.validation.errorCode).toBe("no_advisory_uses");
  });

  it("does not allow a second backup generator in the same district", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "res-3" });
    engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "central" }, "r3a");
    const again = engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "central" }, "r3b");
    expect(again.state).toBe("rejected");
    expect(again.validation.errorCode).toBe("backup_already_active");
  });

  it("backup generator enforces a power floor while active and expires", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "res-4" });
    // drain industrial power first with a reroute away
    engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "industrial" }, "r4a");
    // push power below the floor with reroutes
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "central" }, "r4b");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "riverside" }, "r4c");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "medical" }, "r4d");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "north" }, "r4e");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "central" }, "r4f");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "central" }, "r4g");
    engine.submitCommand("REROUTE_POWER", { from: "industrial", to: "central" }, "r4h");
    for (let i = 0; i < 3; i += 1) {
      engine.step();
    }
    expect(engine.worldState.districts["industrial"]!.power).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 121; i += 1) {
      engine.step();
    }
    expect(engine.worldState.internal.backupActive["industrial"]).toBeUndefined();
  });
});
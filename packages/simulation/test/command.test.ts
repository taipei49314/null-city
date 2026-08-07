import { describe, expect, it } from "vitest";
import { blackRiver } from "@null-city/test-fixtures";
import type { CommandEnvelope } from "@null-city/contracts";
import { SimulationEngine, SeededRandom } from "../src/index.js";
import { minimalScenario, runUntil } from "./observation-pipeline.test.js";

function engineAt(seed = 49314) {
  const engine = new SimulationEngine({
    scenario: blackRiver(),
    seed,
    sessionId: "cmd-test",
  });
  return engine;
}

function accepted(result: CommandEnvelope): asserts result is CommandEnvelope & { state: "accepted" } {
  expect(result.state, String(result.validation)).toBe("accepted");
}

describe("command validation", () => {
  it("accepts a valid dispatch and reports ETA", () => {
    const engine = engineAt();
    runUntil(engine, 12);
    const result = engine.submitCommand(
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "industrial", task: "power_repair" },
      "cmd-acc-1",
    );
    accepted(result);
    expect(result.etaTick).toBe(18);
    expect(engine.eventLog.some((e) => e.kind === "TeamDispatched")).toBe(true);
  });

  it("rejects an unknown team with a readable reason", () => {
    const engine = engineAt();
    const result = engine.submitCommand(
      "DISPATCH_TEAM",
      { teamId: "ghost-team", target: "industrial", task: "power_repair" },
      "cmd-unk-team",
    );
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("unknown_team");
    const rejected = engine.eventLog.find(
      (e) =>
        e.kind === "CommandRejected" &&
        (e.payload as Record<string, unknown>)["commandId"] === result.commandId,
    );
    expect(rejected && (rejected.payload as Record<string, unknown>)["code"]).toBe("unknown_team");
  });

  it("rejects an unknown district", () => {
    const engine = engineAt();
    const result = engine.submitCommand(
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "atlantis", task: "power_repair" },
      "cmd-unk-dist",
    );
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("unknown_district");
  });

  it("rejects a task incompatible with the team type", () => {
    const engine = engineAt();
    const result = engine.submitCommand(
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "medical", task: "medical_support" },
      "cmd-bad-task",
    );
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("task_incompatible");
  });

  it("rejects dispatching a team that is already in transit", () => {
    const engine = engineAt();
    engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "cmd-t1");
    const result = engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "medical", task: "power_repair" }, "cmd-t2");
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("team_in_transit");
  });

  it("rejects re-dispatching a working team that is not reschedulable", () => {
    // Compiled scenarios are deep-frozen, so the variant is built from a copy.
    const scenario = structuredClone(blackRiver());
    const power1 = scenario.teams.find((team) => team.teamId === "power-1");
    expect(power1).toBeDefined();
    power1!.reschedulable = false;
    const engine = new SimulationEngine({ scenario, seed: 1, sessionId: "cmd-ns" });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "cmd-n1");
    while (engine.currentTick < 20 && engine.step()) {
      // let the team arrive and start working
    }
    const result = engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "medical", task: "power_repair" }, "cmd-n2");
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("team_not_reschedulable");
  });

  it("rejects malformed parameters via zod", () => {
    const engine = engineAt();
    const result = engine.submitCommand("DISPATCH_TEAM", { teamId: "" }, "cmd-malformed");
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("invalid_params");
  });

  it("rejects an unknown command name", () => {
    const engine = engineAt();
    // @ts-expect-error intentionally passing an unknown command name
    const result = engine.submitCommand("NUKE_CITY", {}, "cmd-nuke");
    expect(result.state).toBe("rejected");
  });

  it("treats repeated idempotency keys as duplicates and executes only once", () => {
    const engine = engineAt();
    const first = engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "dup-key-1");
    const second = engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "dup-key-1");
    accepted(first);
    expect(second.state).toBe("rejected");
    expect(second.validation.errorCode).toBe("duplicate_command");
    const dispatched = engine.eventLog.filter(
      (e) => e.kind === "TeamDispatched" && (e.payload as Record<string, unknown>)["teamId"] === "power-1",
    );
    expect(dispatched).toHaveLength(1);
  });

  it("accepts then cancels an order and changes team state", () => {
    const engine = engineAt();
    engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-1", target: "industrial", task: "hazard_control" }, "cmd-c1");
    const teamBefore = engine.worldState.teams.find((t) => t.teamId === "fire-1")!;
    const cancel = engine.submitCommand("CANCEL_ORDER", { orderId: teamBefore.order!.orderId, reason: "reroute" }, "cmd-c2");
    accepted(cancel);
    const teamAfter = engine.worldState.teams.find((t) => t.teamId === "fire-1")!;
    expect(teamAfter.status).toBe("idle");
    expect(teamAfter.order).toBeNull();
    expect(engine.worldState.score.breakdown.some((b) => b.id === "wasted_dispatch")).toBe(true);
  });

  it("rejects cancelling an unknown order", () => {
    const engine = engineAt();
    const result = engine.submitCommand("CANCEL_ORDER", { orderId: "nope", reason: "x" }, "cmd-bad-cancel");
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("unknown_order");
  });

  it("accepts power reroute and changes district power", () => {
    const engine = engineAt();
    const beforeFrom = engine.worldState.districts["central"]!.power;
    const beforeTo = engine.worldState.districts["riverside"]!.power;
    const result = engine.submitCommand("REROUTE_POWER", { from: "central", to: "riverside" }, "cmd-reroute");
    accepted(result);
    // source district loses exactly 10; the target gains and is clamped at 100
    expect(engine.worldState.districts["central"]!.power).toBe(beforeFrom - 10);
    expect(engine.worldState.districts["riverside"]!.power).toBe(Math.min(100, beforeTo + 15));
    expect(engine.worldState.districts["riverside"]!.power).toBeGreaterThan(beforeTo);
  });

  it("rejects rerouting a district into itself", () => {
    const engine = engineAt();
    const result = engine.submitCommand("REROUTE_POWER", { from: "central", to: "central" }, "cmd-reroute-self");
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("same_district");
  });

  it("close/reopen a route toggles its state and blocks team travel when isolated", () => {
    const engine = new SimulationEngine({ scenario: minimalScenario(), seed: 1, sessionId: "cmd-route" });
    engine.submitCommand("CLOSE_ROUTE", { route: "central-north" }, "cmd-close");
    expect(engine.worldState.routes["central-north"]!.closed).toBe(true);
    const blocked = engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-1", target: "north", task: "hazard_control" }, "cmd-blocked");
    expect(blocked.state).toBe("rejected");
    expect(blocked.validation.errorCode).toBe("no_open_route");
    engine.submitCommand("REOPEN_ROUTE", { route: "central-north" }, "cmd-reopen");
    expect(engine.worldState.routes["central-north"]!.closed).toBe(false);
    const ok = engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-1", target: "north", task: "hazard_control" }, "cmd-ok");
    accepted(ok);
  });

  it("supports communication priority and backup activation commands", () => {
    const engine = new SimulationEngine({ scenario: minimalScenario(), seed: 1, sessionId: "cmd-util" });
    const priority = engine.submitCommand("PRIORITIZE_COMMUNICATION", { district: "central", ticks: 30 }, "cmd-prio");
    accepted(priority);
    const backup = engine.submitCommand("ACTIVATE_BACKUP_GENERATOR", { district: "central" }, "cmd-backup");
    accepted(backup);
    expect(engine.worldState.resources.backupGenerators).toBe(0);
  });

  it("issues advisories and records misadvisory cost for wrong evacuations", () => {
    const engine = engineAt();
    const result = engine.submitCommand(
      "ISSUE_PUBLIC_ADVISORY",
      { district: "central", text: "evacuate now", severity: "evacuation" },
      "cmd-advisory",
    );
    accepted(result);
    expect(engine.worldState.resources.advisoryUses).toBe(2);
    expect(engine.worldState.resources.misadvisoryCost).toBeGreaterThan(0);
    expect(engine.worldState.districts["central"]!.traffic).toBeLessThan(80);
  });
});

describe("command determinism scaffolding", () => {
  it("SeededRandom is wired but not directly consumed by tests (sanity import)", () => {
    const rng = new SeededRandom(1);
    expect(rng.next()).toBeTypeOf("number");
  });
});
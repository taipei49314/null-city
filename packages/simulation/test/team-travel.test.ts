import { describe, expect, it } from "vitest";
import { blackRiver } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

describe("team travel", () => {
  it("travel time equals the shortest path over open routes", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "travel-1" });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "t1");
    const dispatched = engine.eventLog.find(
      (e) => e.kind === "TeamDispatched" && (e.payload as Record<string, unknown>)["teamId"] === "power-1",
    )!;
    const dispatchedPayload = dispatched.payload as Record<string, unknown>;
    expect(dispatchedPayload["travelTicks"]).toBe(6);
    expect(dispatchedPayload["etaTick"]).toBe(6);
  });

  it("team arrives exactly at its ETA and starts working", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "travel-2" });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-2", target: "medical", task: "hazard_control" }, "t2");
    const eta = engine.worldState.teams.find((t) => t.teamId === "fire-2")!.etaTick!;
    for (let i = 0; i < eta - 1; i += 1) {
      engine.step();
      expect(engine.worldState.teams.find((t) => t.teamId === "fire-2")!.status).toBe("transit");
    }
    engine.step();
    const team = engine.worldState.teams.find((t) => t.teamId === "fire-2")!;
    expect(team.status).toBe("working");
    expect(
      engine.eventLog.some((e) => e.kind === "TeamArrived" && (e.payload as Record<string, unknown>)["teamId"] === "fire-2"),
    ).toBe(true);
  });

  it("teams never teleport: travel takes at least one tick per segment", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "travel-3" });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-1", target: "medical", task: "hazard_control" }, "t3");
    const team = engine.worldState.teams.find((t) => t.teamId === "fire-1")!;
    expect(team.etaTick).toBe(3);
    engine.step();
    expect(engine.worldState.teams.find((t) => t.teamId === "fire-1")!.status).toBe("transit");
  });

  it("a closed road forces a longer detour", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "travel-4" });
    engine.submitCommand("CLOSE_ROUTE", { route: "north-riverside" }, "t4-close");
    engine.submitCommand("DISPATCH_TEAM", { teamId: "fire-2", target: "riverside", task: "water_restore" }, "t4");
    const dispatched = engine.eventLog.find(
      (e) => e.kind === "TeamDispatched" && (e.payload as Record<string, unknown>)["teamId"] === "fire-2",
    )!;
    expect((dispatched.payload as Record<string, unknown>)["travelTicks"]).toBe(9);
  });

  it("rerouting a team mid-transit wastes travel ticks", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 1, sessionId: "travel-5" });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "power-1", target: "industrial", task: "power_repair" }, "t5a");
    const team = engine.worldState.teams.find((t) => t.teamId === "power-1")!;
    engine.step();
    engine.step();
    engine.submitCommand("CANCEL_ORDER", { orderId: team.order!.orderId, reason: "better plan" }, "t5b");
    expect(team.wastedTicks).toBeGreaterThan(0);
    expect(team.status).toBe("idle");
  });
});
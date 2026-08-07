import { describe, expect, it } from "vitest";
import type { CommandName } from "@null-city/contracts";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

const COMMANDS: Array<{ commandName: CommandName; params: Record<string, unknown> }> = [
  { commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "industrial", task: "power_repair" } },
  { commandName: "REROUTE_POWER", params: { from: "central", to: "riverside" } },
  { commandName: "ACTIVATE_BACKUP_GENERATOR", params: { district: "central" } },
  { commandName: "CLOSE_ROUTE", params: { route: "central-north" } },
  { commandName: "REOPEN_ROUTE", params: { route: "central-north" } },
  { commandName: "REQUEST_VERIFICATION", params: { target: "central", teamId: "verify-1" } },
  { commandName: "ISSUE_PUBLIC_ADVISORY", params: { district: "central", text: "stay calm", severity: "info" } },
  { commandName: "PRIORITIZE_COMMUNICATION", params: { district: "central", ticks: 10 } },
  { commandName: "CANCEL_ORDER", params: { orderId: "order-1", reason: "done" } },
];

function completedEngine(): SimulationEngine {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "finalization" });
  runScript(engine, goldenScript());
  engine.runToEnd();
  return engine;
}

describe("run finalization", () => {
  it.each(COMMANDS)("rejects $commandName after completion without mutation", ({ commandName, params }) => {
    const engine = completedEngine();
    const before = {
      hash: engine.eventLogHash,
      count: engine.eventLog.length,
      score: engine.worldState.score.total,
      digest: engine.finalStateDigest(),
      phase: engine.worldState.phase,
    };

    const result = engine.submitCommand(commandName, params, `post-complete-${commandName}`);
    expect(result.state).toBe("rejected");
    expect(result.validation.errorCode).toBe("run_completed");
    expect(engine.eventLogHash).toBe(before.hash);
    expect(engine.eventLog.length).toBe(before.count);
    expect(engine.worldState.score.total).toBe(before.score);
    expect(engine.finalStateDigest()).toBe(before.digest);
    expect(engine.worldState.phase).toBe(before.phase);
    expect(engine.step()).toBe(false);
  });

  it("emits exactly one ScenarioCompleted and freezes repeated reads", () => {
    const engine = completedEngine();
    const completed = engine.eventLog.filter((event) => event.kind === "ScenarioCompleted");
    expect(completed).toHaveLength(1);
    const first = engine.result();
    const second = engine.result();
    expect(second.eventLogHash).toBe(first.eventLogHash);
    expect(second.finalStateDigest).toBe(first.finalStateDigest);
    expect(second.score.total).toBe(first.score.total);
    expect(second.eventCount).toBe(first.eventCount);
  });
});

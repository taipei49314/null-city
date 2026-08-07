import { describe, expect, it } from "vitest";
import { blackRiver, runScript, type ScriptedCommand } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";

function finish(script: ScriptedCommand[], sessionId: string): SimulationEngine {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId });
  runScript(engine, script);
  engine.runToEnd();
  return engine;
}

/** Early correct action — same as golden, front-loaded. */
const earlyAction = (): ScriptedCommand[] => [
  { atTick: 5, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "industrial", task: "power_repair" }, idempotencyKey: "early-01" },
  { atTick: 5, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "industrial", task: "hazard_control" }, idempotencyKey: "early-02" },
  { atTick: 8, commandName: "DISPATCH_TEAM", params: { teamId: "power-2", target: "medical", task: "power_repair" }, idempotencyKey: "early-03" },
  { atTick: 10, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "industrial", ticks: 120 }, idempotencyKey: "early-04" },
  { atTick: 20, commandName: "ACTIVATE_BACKUP_GENERATOR", params: { district: "riverside" }, idempotencyKey: "early-05" },
  { atTick: 25, commandName: "DISPATCH_TEAM", params: { teamId: "fire-2", target: "riverside", task: "water_restore" }, idempotencyKey: "early-06" },
  { atTick: 30, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "riverside", task: "power_repair" }, idempotencyKey: "early-07" },
  { atTick: 40, commandName: "REQUEST_VERIFICATION", params: { target: "industrial", teamId: "verify-1" }, idempotencyKey: "early-08" },
  { atTick: 50, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "industrial", task: "comms_repair" }, idempotencyKey: "early-09" },
];

/** Same actions, delayed past the decision-delay grace window. */
const lateAction = (): ScriptedCommand[] =>
  earlyAction().map((cmd, i) => ({
    ...cmd,
    atTick: cmd.atTick + 40,
    idempotencyKey: `late-${String(i + 1).padStart(2, "0")}`,
  }));

/** Wrong district / wrong task — activity without addressing the crisis. */
const wrongAction = (): ScriptedCommand[] => [
  { atTick: 12, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "north", task: "power_repair" }, idempotencyKey: "wrong-01" },
  { atTick: 15, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "central", task: "hazard_control" }, idempotencyKey: "wrong-02" },
  { atTick: 20, commandName: "ISSUE_PUBLIC_ADVISORY", params: { district: "industrial", message: "all clear" }, idempotencyKey: "wrong-03" },
];

describe("scoring fixtures", () => {
  it("early action scores better than late action (decision delay / cascade)", () => {
    const early = finish(earlyAction(), "score-early");
    const late = finish(lateAction(), "score-late");
    expect(early.worldState.score.total).toBeGreaterThan(late.worldState.score.total);
    expect(early.worldState.score.raw.decisionDelayTicks).toBeLessThanOrEqual(
      late.worldState.score.raw.decisionDelayTicks,
    );
    // Weighted points are negative; a smaller delay must cost no more.
    expect(early.worldState.score.decisionDelayPoints).toBeGreaterThanOrEqual(
      late.worldState.score.decisionDelayPoints,
    );
  });

  it("separates raw measurements from weighted point contributions", () => {
    const early = finish(earlyAction(), "score-units");
    const score = early.worldState.score;
    // Audit finding P1-06: `eventsHandled` used to hold `10 x count`.
    expect(score.raw.incidentsHandled).toBe(early.result().handledIncidents.length);
    expect(score.eventsHandledPoints).toBe(10 * score.raw.incidentsHandled);
    expect(score.raw.incidentsMissed).toBe(early.result().activeIncidents.length);
    expect(score.eventsMissedPoints).toBe(-15 * score.raw.incidentsMissed);
    expect(Number.isInteger(score.raw.decisionDelayTicks)).toBe(true);
  });

  it("charges decision delay for an incident that is never acted on", () => {
    // The inherited implementation skipped incidents with no recorded action,
    // so total neglect incurred no delay penalty at all.
    const none = finish([], "score-none-delay");
    expect(none.worldState.score.raw.incidentsWithoutAction).toBeGreaterThan(0);
    expect(none.worldState.score.raw.decisionDelayTicks).toBeGreaterThan(0);
    expect(none.worldState.score.decisionDelayPoints).toBeLessThan(0);
  });

  it("no action is worse than early action and leaves incidents active", () => {
    const early = finish(earlyAction(), "score-early-2");
    const none = finish([], "score-none");
    expect(none.worldState.score.total).toBeLessThan(early.worldState.score.total);
    expect(none.worldState.score.total).toBeLessThan(0);
    expect(none.result().activeIncidents.length).toBeGreaterThan(0);
    expect(none.worldState.score.eventsMissedPoints).toBeLessThan(0);
  });

  it("wrong action underperforms early correct action", () => {
    const early = finish(earlyAction(), "score-early-3");
    const wrong = finish(wrongAction(), "score-wrong");
    expect(wrong.worldState.score.total).toBeLessThan(early.worldState.score.total);
  });

  it("effective arrival (early script) resolves initial incidents", () => {
    const early = finish(earlyAction(), "score-effective");
    const handled = early.result().handledIncidents;
    expect(handled).toEqual(expect.arrayContaining(["substation_fault", "hospital_power"]));
    expect(early.worldState.score.eventsHandledPoints).toBeGreaterThan(0);
  });

  it("breakdown reconciles for each fixture path", () => {
    for (const [id, script] of [
      ["early", earlyAction()],
      ["late", lateAction()],
      ["none", [] as ScriptedCommand[]],
      ["wrong", wrongAction()],
    ] as const) {
      const engine = finish(script, `score-reconcile-${id}`);
      const sum = engine.worldState.score.breakdown.reduce((acc, b) => acc + b.delta, 0);
      expect(sum).toBeCloseTo(engine.worldState.score.total, 1);
    }
  });
});

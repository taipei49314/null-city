import { describe, expect, it } from "vitest";
import type { PlayerSessionState } from "@null-city/contracts";

import { createNoopPolicy } from "../src/policies/noop.js";
import { createReactiveGreedyPolicy } from "../src/policies/reactiveGreedy.js";
import { createVerificationFirstPolicy } from "../src/policies/verificationFirst.js";

function baseState(overrides: Partial<PlayerSessionState> = {}): PlayerSessionState {
  return {
    stream: "player",
    sessionId: "s1",
    scenarioId: "black-river",
    tick: 10,
    phase: "running",
    claims: [],
    evidence: [],
    assessments: [],
    teams: [],
    routes: [],
    resources: { backupGenerators: 2, advisoryUses: 2 },
    score: { total: 0, recent: [] },
    playerEventCount: 0,
    playerLogHash: "",
    ...overrides,
  };
}

describe("createNoopPolicy", () => {
  it("never issues a command or an assessment regardless of state", async () => {
    const policy = createNoopPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [{ teamId: "power-1", type: "power", location: "industrial", status: "idle", etaTick: null, orderTarget: null, orderTask: null }],
        claims: [{ id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "reported", evidenceIds: [], asOfTick: 5 }],
      }),
    });
    expect(decision.commands).toEqual([]);
    expect(decision.assessments).toEqual([]);
  });
});

describe("createReactiveGreedyPolicy", () => {
  it("dispatches an idle team to the oldest unresolved claim in an untargeted district", async () => {
    const policy = createReactiveGreedyPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [
          { teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
          { teamId: "verify-1", type: "verification", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
        ],
        claims: [
          { id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "reported", evidenceIds: [], asOfTick: 5 },
        ],
      }),
    });
    expect(decision.commands).toEqual([
      { commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "industrial", task: "power_repair" } },
    ]);
    expect(decision.assessments).toEqual([]);
  });

  it("never dispatches a busy team or targets an already-resolved claim", async () => {
    const policy = createReactiveGreedyPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [{ teamId: "power-1", type: "power", location: "central", status: "transit", etaTick: 20, orderTarget: "industrial", orderTask: "power_repair" }],
        claims: [
          { id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "verified", evidenceIds: [], asOfTick: 5 },
        ],
      }),
    });
    expect(decision.commands).toEqual([]);
  });

  it("does not send two teams to the same district in one decision", async () => {
    const policy = createReactiveGreedyPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [
          { teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
          { teamId: "power-2", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
        ],
        claims: [
          { id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "reported", evidenceIds: [], asOfTick: 5 },
        ],
      }),
    });
    expect(decision.commands).toHaveLength(1);
  });
});

describe("createVerificationFirstPolicy", () => {
  it("assesses every new claim exactly once and never re-submits after re-decide", async () => {
    const policy = createVerificationFirstPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const state = baseState({
      claims: [
        { id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "reported", evidenceIds: [], asOfTick: 5 },
      ],
    });
    const first = await policy.decide({ state });
    expect(first.assessments).toHaveLength(1);
    expect(first.assessments[0]!.claimId).toBe("c1");

    const second = await policy.decide({ state });
    expect(second.assessments).toHaveLength(0);
  });

  it("prioritizes contested claims for idle verification teams over reported claims", async () => {
    const policy = createVerificationFirstPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [{ teamId: "verify-1", type: "verification", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null }],
        claims: [
          { id: "reported-1", subject: "a", predicate: "b", value: 1, districtId: "north", firstObservedTick: 1, lastUpdatedTick: 1, status: "reported", evidenceIds: [], asOfTick: 1 },
          { id: "contested-1", subject: "a", predicate: "b", value: 1, districtId: "riverside", firstObservedTick: 3, lastUpdatedTick: 3, status: "contested", evidenceIds: [], asOfTick: 3 },
        ],
      }),
    });
    const verificationCommand = decision.commands.find((c) => c.commandName === "REQUEST_VERIFICATION");
    expect(verificationCommand?.params).toMatchObject({ teamId: "verify-1", claimId: "contested-1" });
    expect(verificationCommand?.params).not.toHaveProperty("target");
  });

  it("falls back to greedy dispatch for idle non-verification teams", async () => {
    const policy = createVerificationFirstPolicy();
    await policy.reset({ scenarioId: "black-river", seed: 1, sessionId: "s1" });
    const decision = await policy.decide({
      state: baseState({
        teams: [{ teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null }],
        claims: [
          { id: "c1", subject: "industrial", predicate: "power", value: true, districtId: "industrial", firstObservedTick: 5, lastUpdatedTick: 5, status: "reported", evidenceIds: [], asOfTick: 5 },
        ],
      }),
    });
    expect(decision.commands).toContainEqual({
      commandName: "DISPATCH_TEAM",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
    });
  });
});

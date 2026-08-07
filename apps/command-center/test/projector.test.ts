import { describe, expect, it } from "vitest";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { applyPlayerEvent, emptyPlayerState, projectPlayerState } from "../src/state/projector";

function envelope<T>(
  sequence: number,
  tick: number,
  kind: PlayerEventEnvelope["kind"],
  payload: T,
): PlayerEventEnvelope {
  return {
    stream: "player",
    sessionId: "session-test",
    sequence,
    tick,
    kind,
    payload,
    previousHash: sequence === 1 ? "" : `hash-${sequence - 1}`,
    hash: `hash-${sequence}`,
  };
}

describe("projector", () => {
  it("starts from an empty, honest state", () => {
    const empty = emptyPlayerState("session-test");
    expect(empty.claims).toEqual([]);
    expect(empty.evidence).toEqual([]);
    expect(empty.teams).toEqual([]);
    expect(empty.routes).toEqual([]);
    expect(empty.phase).toBe("running");
    expect(empty.playerEventCount).toBe(0);
  });

  it("hydrates teams, routes, and resources only from SessionStarted", () => {
    const started = envelope(1, 0, "SessionStarted", {
      scenarioId: "black-river",
      seed: 49314,
      totalTicks: 540,
      teams: [
        { teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
      ],
      routes: [{ id: "central-industrial", closed: false, knownClosedAtTick: null }],
      resources: { backupGenerators: 3, advisoryUses: 3 },
    });
    const state = applyPlayerEvent(emptyPlayerState("session-test"), started);
    expect(state.teams).toHaveLength(1);
    expect(state.teams[0]!.teamId).toBe("power-1");
    expect(state.routes).toHaveLength(1);
    expect(state.resources).toEqual({ backupGenerators: 3, advisoryUses: 3 });
    expect(state.scenarioId).toBe("black-river");
  });

  it("upserts evidence by id without duplicating", () => {
    const evidence = {
      id: "ev-1",
      claimId: "claim-1",
      sourceId: "grid-sensor",
      observedTick: 10,
      deliveredTick: 13,
      content: "breaker tripped",
      category: "telemetry",
      reliability: 0.9,
      verified: false,
    };
    let state = emptyPlayerState("session-test");
    state = applyPlayerEvent(state, envelope(1, 13, "EvidenceRecorded", { evidence }));
    state = applyPlayerEvent(state, envelope(2, 14, "EvidenceRecorded", { evidence: { ...evidence, content: "updated" } }));
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]!.content).toBe("updated");
  });

  it("marks evidence verified only for the matching claim on a verified outcome", () => {
    const claim = {
      id: "claim-1",
      subject: "industrial",
      predicate: "has_power_fault",
      value: true,
      districtId: "industrial" as const,
      firstObservedTick: 10,
      lastUpdatedTick: 10,
      status: "reported" as const,
      evidenceIds: ["ev-1"],
      asOfTick: 10,
    };
    const evidence = {
      id: "ev-1",
      claimId: "claim-1",
      sourceId: "grid-sensor",
      observedTick: 10,
      deliveredTick: 13,
      content: "breaker tripped",
      category: "telemetry",
      reliability: 0.9,
      verified: false,
    };
    let state = emptyPlayerState("session-test");
    state = applyPlayerEvent(state, envelope(1, 10, "ClaimUpdated", { claim, reason: "reported" }));
    state = applyPlayerEvent(state, envelope(2, 13, "EvidenceRecorded", { evidence }));
    state = applyPlayerEvent(
      state,
      envelope(3, 30, "VerificationResolved", { claimId: "claim-1", teamId: "verify-1", outcome: "verified", resolvedTick: 30 }),
    );
    expect(state.claims[0]!.status).toBe("verified");
    expect(state.evidence[0]!.verified).toBe(true);
  });

  it("tracks running score total and recent deltas", () => {
    let state = emptyPlayerState("session-test");
    state = applyPlayerEvent(state, envelope(1, 5, "PublicScoreChanged", { delta: -2, reason: "delay", category: "decision", total: -2 }));
    state = applyPlayerEvent(state, envelope(2, 9, "PublicScoreChanged", { delta: 4, reason: "handled", category: "response", total: 2 }));
    expect(state.score.total).toBe(2);
    expect(state.score.recent).toHaveLength(2);
  });

  it("marks phase completed and freezes tick/score on RunCompleted", () => {
    let state = emptyPlayerState("session-test");
    state = applyPlayerEvent(state, envelope(1, 540, "RunCompleted", { finalTick: 540, scoreTotal: 21.9, claimCount: 4, evidenceCount: 12 }));
    expect(state.phase).toBe("completed");
    expect(state.tick).toBe(540);
    expect(state.score.total).toBe(21.9);
  });

  it("projectPlayerState folds a full event list identically to sequential applyPlayerEvent", () => {
    const events: PlayerEventEnvelope[] = [
      envelope(1, 0, "SessionStarted", {
        scenarioId: "black-river",
        seed: 1,
        totalTicks: 540,
        teams: [],
        routes: [],
        resources: { backupGenerators: 3, advisoryUses: 3 },
      }),
      envelope(2, 12, "PublicScoreChanged", { delta: -1, reason: "x", category: "y", total: -1 }),
    ];
    const folded = projectPlayerState(events);
    let manual = emptyPlayerState("session-test");
    for (const event of events) {
      manual = applyPlayerEvent(manual, event);
    }
    expect(folded).toEqual(manual);
  });
});

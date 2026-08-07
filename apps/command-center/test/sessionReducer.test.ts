import { describe, expect, it } from "vitest";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { initialSessionViewState, sessionReducer } from "../src/state/sessionReducer";
import { emptyPlayerState } from "../src/state/projector";

function evidenceEvent(sequence: number, tick: number, id: string): PlayerEventEnvelope {
  return {
    stream: "player",
    sessionId: "session-test",
    sequence,
    tick,
    kind: "EvidenceRecorded",
    payload: {
      evidence: {
        id,
        claimId: "claim-1",
        sourceId: "grid-sensor",
        observedTick: tick - 1,
        deliveredTick: tick,
        content: `content-${id}`,
        category: "telemetry",
        reliability: 0.8,
        verified: false,
      },
    },
    previousHash: `hash-${sequence - 1}`,
    hash: `hash-${sequence}`,
  };
}

describe("sessionReducer", () => {
  it("starts in loading phase with no player state", () => {
    const state = initialSessionViewState();
    expect(state.phase).toBe("loading");
    expect(state.player).toBeNull();
  });

  it("LOAD_NOT_FOUND moves to the not-found phase", () => {
    const state = sessionReducer(initialSessionViewState(), { type: "LOAD_NOT_FOUND" });
    expect(state.phase).toBe("not-found");
  });

  it("applies fresh events and advances lastAppliedSequence, building an activity log", () => {
    const state = sessionReducer(initialSessionViewState(), { type: "EVENTS", events: [evidenceEvent(1, 10, "ev-1")] });
    expect(state.phase).toBe("ready");
    expect(state.player?.evidence).toHaveLength(1);
    expect(state.lastAppliedSequence).toBe(1);
    expect(state.activity).toHaveLength(1);
  });

  it("deduplicates events already applied by sequence number", () => {
    let state = sessionReducer(initialSessionViewState(), { type: "EVENTS", events: [evidenceEvent(1, 10, "ev-1")] });
    // Simulate the same event arriving twice (REST response + WS broadcast).
    state = sessionReducer(state, { type: "EVENTS", events: [evidenceEvent(1, 10, "ev-1")] });
    expect(state.player?.evidence).toHaveLength(1);
    expect(state.activity).toHaveLength(1);
  });

  it("only applies events newer than lastAppliedSequence out of an unordered batch", () => {
    let state = sessionReducer(initialSessionViewState(), {
      type: "EVENTS",
      events: [evidenceEvent(1, 10, "ev-1"), evidenceEvent(2, 11, "ev-2")],
    });
    expect(state.lastAppliedSequence).toBe(2);
    state = sessionReducer(state, { type: "EVENTS", events: [evidenceEvent(1, 10, "ev-1"), evidenceEvent(3, 12, "ev-3")] });
    expect(state.lastAppliedSequence).toBe(3);
    expect(state.player?.evidence.map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
    expect(state.activity).toHaveLength(3);
  });

  it("HYDRATE sets player state directly and clears prior errors", () => {
    const withError = sessionReducer(initialSessionViewState(), {
      type: "ERROR",
      error: { code: "network_error", message: "offline" },
    });
    const player = emptyPlayerState("session-test", "black-river");
    const hydrated = sessionReducer(withError, { type: "HYDRATE", player });
    expect(hydrated.phase).toBe("ready");
    expect(hydrated.player).toBe(player);
    expect(hydrated.lastError).toBeNull();
  });

  it("ERROR sets lastError, and goes to error phase only when no player state exists yet", () => {
    const noPlayer = sessionReducer(initialSessionViewState(), {
      type: "ERROR",
      error: { code: "network_error", message: "offline" },
    });
    expect(noPlayer.phase).toBe("error");

    const withPlayer = sessionReducer(
      { ...initialSessionViewState(), phase: "ready", player: emptyPlayerState("s") },
      { type: "ERROR", error: { code: "ws_error", message: "dropped" } },
    );
    expect(withPlayer.phase).toBe("ready");
    expect(withPlayer.lastError?.code).toBe("ws_error");
  });

  it("CLEAR_ERROR removes the last error without touching other fields", () => {
    const state = sessionReducer(
      { ...initialSessionViewState(), lastError: { code: "x", message: "y" } },
      { type: "CLEAR_ERROR" },
    );
    expect(state.lastError).toBeNull();
  });

  it("COMMAND_FEEDBACK records ok/error feedback with an incrementing key", () => {
    let state = sessionReducer(initialSessionViewState(), {
      type: "COMMAND_FEEDBACK",
      commandName: "DISPATCH_TEAM",
      ok: false,
      message: "task_incompatible",
      tick: 12,
    });
    expect(state.feedback?.ok).toBe(false);
    expect(state.feedback?.key).toBe(1);
    state = sessionReducer(state, {
      type: "COMMAND_FEEDBACK",
      commandName: "DISPATCH_TEAM",
      ok: true,
      message: "accepted",
      tick: 13,
    });
    expect(state.feedback?.ok).toBe(true);
    expect(state.feedback?.key).toBe(2);
  });

  it("captures totalTicks from SessionStarted without exposing it via PlayerSessionState", () => {
    const started: PlayerEventEnvelope = {
      stream: "player",
      sessionId: "session-test",
      sequence: 1,
      tick: 0,
      kind: "SessionStarted",
      payload: {
        scenarioId: "black-river",
        seed: 49314,
        totalTicks: 540,
        teams: [],
        routes: [],
        resources: { backupGenerators: 3, advisoryUses: 3 },
      },
      previousHash: "",
      hash: "hash-1",
    };
    const state = sessionReducer(initialSessionViewState(), { type: "EVENTS", events: [started] });
    expect(state.totalTicks).toBe(540);
    expect(state.player).not.toHaveProperty("totalTicks");
  });
});

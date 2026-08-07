import { describe, expect, it } from "vitest";

import { blackRiver } from "@null-city/test-fixtures";

import { SimulationEngine } from "../src/engine.js";

/**
 * M8 regression: a resume snapshot's embedded truth log must verify against
 * its own hash chain before the engine adopts it.
 *
 * `loadSnapshotFromFile` validated the chain, but resume is also reachable
 * from the public REST transport (`POST /sessions` with a `resume` body),
 * which never went through that path — so a snapshot carrying a tampered
 * truth log became a live session. These tests attack the engine boundary
 * every caller shares.
 */

function snapshotAt(tick: number, sessionId = "resume-guard") {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId });
  for (let i = 0; i < tick; i += 1) {
    engine.step();
  }
  return engine.snapshot();
}

function resume(snapshot: unknown, sessionId = "resume-guard"): SimulationEngine {
  return new SimulationEngine({
    scenario: blackRiver(),
    seed: 49314,
    sessionId,
    resume: snapshot as never,
  });
}

describe("resume validates the embedded truth log", () => {
  it("accepts an untampered snapshot (positive control)", () => {
    expect(() => resume(snapshotAt(80))).not.toThrow();
  });

  it("rejects a snapshot whose event payload was altered", () => {
    const snapshot = structuredClone(snapshotAt(80)) as never as { events: { payload: unknown }[] };
    snapshot.events[10]!.payload = { tampered: true };
    expect(() => resume(snapshot)).toThrow(/event stream invalid/i);
  });

  it("rejects a snapshot with a removed event (sequence gap)", () => {
    const snapshot = structuredClone(snapshotAt(80)) as never as { events: unknown[]; sequence: number };
    snapshot.events.splice(12, 1);
    snapshot.sequence -= 1;
    expect(() => resume(snapshot)).toThrow(/event stream invalid/i);
  });

  it("rejects a snapshot whose sequence counter disagrees with its event count", () => {
    const snapshot = structuredClone(snapshotAt(80)) as never as { sequence: number };
    snapshot.sequence += 3;
    expect(() => resume(snapshot)).toThrow(/sequence counter mismatch/i);
  });

  it("rejects a snapshot with a forged genesis anchor", () => {
    const snapshot = structuredClone(snapshotAt(80)) as never as { events: { previousHash: string }[] };
    snapshot.events[0]!.previousHash = "f".repeat(64);
    expect(() => resume(snapshot)).toThrow(/event stream invalid/i);
  });

  it("rejects a snapshot whose events belong to another session", () => {
    const snapshot = structuredClone(snapshotAt(80)) as never as {
      events: { sessionId: string }[];
    };
    snapshot.events[5]!.sessionId = "someone-else";
    expect(() => resume(snapshot)).toThrow(/event stream invalid/i);
  });

  it("rejects a snapshot with a rolled-back tick in the log", () => {
    const snapshot = structuredClone(snapshotAt(120)) as never as { events: { tick: number }[] };
    snapshot.events[snapshot.events.length - 1]!.tick = 0;
    expect(() => resume(snapshot)).toThrow(/event stream invalid/i);
  });
});

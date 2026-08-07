import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  sha256,
  eventHash,
  verifyEventChain,
  verifyEventStream,
  clamp,
  GENESIS_PREVIOUS_HASH,
} from "../src/truth-entry.js";

describe("canonical", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalJson({ b: 2, a: { d: 1, c: [3, { f: 1, e: 2 }] } });
    const b = canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 1 }, b: 2 });
    expect(a).toBe(b);
  });

  it("serializes booleans, nulls, numbers and strings stably", () => {
    expect(canonicalJson({ x: true, y: null, z: 1.5, s: "a" })).toBe(
      canonicalJson({ s: "a", y: null, z: 1.5, x: true }),
    );
  });
});

describe("sha256", () => {
  it("is deterministic and 64 hex chars", () => {
    expect(sha256("null-city")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("null-city")).toBe(sha256("null-city"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("eventHash", () => {
  it("is stable across equivalent payload key orders", () => {
    const base = {
      sessionId: "s",
      sequence: 3,
      tick: 7,
      kind: "ActionApplied" as const,
      payload: { result: 5, delta: 1, action: "x", attribute: "power", target: "central" },
      previousHash: "prev",
    };
    const reordered = {
      ...base,
      payload: { target: "central", action: "x", attribute: "power", delta: 1, result: 5 },
    };
    expect(eventHash(base)).toBe(eventHash(reordered));
  });

  it("changes when any field changes", () => {
    const base = {
      sessionId: "s",
      sequence: 3,
      tick: 7,
      kind: "ActionApplied" as const,
      payload: { action: "x", target: "central", attribute: "power", delta: 1, result: 5 },
      previousHash: "prev",
    };
    expect(eventHash(base)).not.toBe(eventHash({ ...base, tick: 8 }));
    expect(eventHash(base)).not.toBe(eventHash({ ...base, payload: { ...base.payload, delta: 2 } }));
    expect(eventHash(base)).not.toBe(eventHash({ ...base, previousHash: "other" }));
  });
});

describe("verifyEventStream", () => {
  function makeEvent(sequence: number, previousHash: string, tick = sequence, sessionId = "s") {
    const envelope = {
      sessionId,
      sequence,
      tick,
      kind: "ActionApplied" as const,
      payload: { action: "x", target: "central", attribute: "power", delta: 1, result: 1 },
      previousHash,
      hash: "",
    };
    envelope.hash = eventHash(envelope);
    return envelope;
  }

  function buildEvents(): Array<ReturnType<typeof makeEvent>> {
    let previousHash = GENESIS_PREVIOUS_HASH;
    const events = [];
    for (let i = 0; i < 4; i += 1) {
      const event = makeEvent(i, previousHash);
      previousHash = event.hash;
      events.push(event);
    }
    return events;
  }

  it("accepts a valid chain", () => {
    const result = verifyEventChain(buildEvents());
    expect(result.validChain).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("rejects a broken chain and reports the sequence", () => {
    const events = buildEvents();
    events[2]!.payload = { ...events[2]!.payload, delta: 99 };
    const result = verifyEventChain(events);
    expect(result.validChain).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("treats an empty list as valid unless requireNonEmpty", () => {
    expect(verifyEventChain([]).validChain).toBe(true);
    expect(verifyEventStream([], { requireNonEmpty: true }).validChain).toBe(false);
  });

  it("rejects arbitrary genesis anchors", () => {
    const badGenesis = makeEvent(0, "not-empty-genesis");
    const result = verifyEventStream([badGenesis]);
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("previous_hash_mismatch");
  });

  it("rejects sequence gaps", () => {
    const events = buildEvents();
    events.splice(2, 1);
    const result = verifyEventStream(events);
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("sequence_gap");
  });

  it("rejects cross-session events", () => {
    const events = buildEvents();
    const foreign = makeEvent(4, events[3]!.hash, 4, "other");
    const result = verifyEventStream([...events, foreign], { expectedSessionId: "s" });
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("session_mismatch");
  });

  it("rejects tick rollback", () => {
    const events = buildEvents();
    const rollback = makeEvent(4, events[3]!.hash, 1);
    const result = verifyEventStream([...events, rollback]);
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("tick_rollback");
  });

  it("rejects unknown kind even with recomputed hash", () => {
    const envelope = {
      sessionId: "s",
      sequence: 0,
      tick: 0,
      kind: "NotARealKind" as "ActionApplied",
      payload: { x: 1 },
      previousHash: GENESIS_PREVIOUS_HASH,
      hash: "",
    };
    envelope.hash = eventHash(envelope);
    const result = verifyEventStream([envelope]);
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("unknown_kind");
  });

  it("rejects terminal hash mismatch when provided", () => {
    const events = buildEvents();
    const result = verifyEventStream(events, { expectedTerminalHash: "0".repeat(64) });
    expect(result.validChain).toBe(false);
    expect(result.reason).toBe("terminal_hash_mismatch");
  });
});

describe("clamp", () => {
  it("clamps to bounds", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

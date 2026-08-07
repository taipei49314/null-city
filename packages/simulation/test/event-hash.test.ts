import { describe, expect, it } from "vitest";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import {
  canonicalJson,
  eventHash,
  sha256,
  verifyEventChain,
  type EventEnvelope,
} from "@null-city/contracts/truth";
import { SimulationEngine } from "../src/index.js";

function sampleEventLog(): EventEnvelope[] {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "hash-test" });
  runScript(engine, goldenScript());
  engine.runToEnd();
  return [...engine.eventLog];
}

describe("canonical serialization", () => {
  it("is independent of object key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("is stable for nested arrays and primitives", () => {
    const first = canonicalJson({ list: [3, 1, 2], flag: true, nil: null, text: "x" });
    const second = canonicalJson({ text: "x", nil: null, flag: true, list: [3, 1, 2] });
    expect(first).toBe(second);
  });
});

describe("event hashing", () => {
  it("sha256 produces deterministic hex output", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("eventHash is deterministic for identical payloads", () => {
    const base = {
      sessionId: "s1",
      sequence: 1,
      tick: 1,
      kind: "ActionApplied" as const,
      payload: { action: "x", target: "central", attribute: "power", delta: 1, result: 50 },
      previousHash: "abc",
    };
    expect(eventHash(base)).toBe(eventHash({ ...base }));
  });

  it("every event in a real run forms a valid hash chain", () => {
    const events = sampleEventLog();
    expect(events.length).toBeGreaterThan(100);
    const check = verifyEventChain(events);
    expect(check.brokenAt).toBeNull();
    expect(check.hash).toBe(events[events.length - 1]!.hash);
  });

  it("tampering with any payload breaks the chain at that sequence", () => {
    const events = sampleEventLog();
    const tampered = events.map((e) => ({ ...e }));
    const target = tampered.find((e) => e.kind === "SystemStateChanged");
    expect(target).toBeDefined();
    const index = tampered.indexOf(target!);
    const payload = JSON.parse(JSON.stringify(target!.payload));
    payload.districts.central.power = 1;
    tampered[index] = { ...target!, payload };
    const check = verifyEventChain(tampered);
    expect(check.brokenAt).toBe(target!.sequence);
  });

  it("tampering with previousHash also breaks the chain", () => {
    const events = sampleEventLog();
    const tampered = events.map((e) => ({ ...e }));
    const index = Math.floor(events.length / 2);
    tampered[index] = { ...tampered[index]!, previousHash: "deadbeef" };
    const check = verifyEventChain(tampered);
    expect(check.brokenAt).toBe(events[index]!.sequence);
  });

  it("sequence numbers are contiguous from 0", () => {
    const events = sampleEventLog();
    events.forEach((event, i) => {
      expect(event.sequence).toBe(i);
    });
  });
});
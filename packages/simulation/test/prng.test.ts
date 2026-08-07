import { describe, expect, it } from "vitest";
import { SeededRandom } from "../src/index.js";

describe("SeededRandom", () => {
  it("produces identical sequences for the same seed", () => {
    const a = new SeededRandom(49314);
    const b = new SeededRandom(49314);
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(seqA).not.toEqual(seqB);
  });

  it("always returns floats in [0, 1)", () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() returns integers within the inclusive bounds", () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 500; i += 1) {
      const v = rng.int(3, 9);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("chance(p) with p=0 is always false and p=1 is always true", () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("state round-trips through fromState()", () => {
    const rng = new SeededRandom(2024);
    rng.next();
    rng.next();
    const state = rng.sampleState();
    const clone = SeededRandom.fromState(state);
    const restA = [rng.next(), rng.next(), rng.next()];
    const restB = [clone.next(), clone.next(), clone.next()];
    expect(restA).toEqual(restB);
  });
});
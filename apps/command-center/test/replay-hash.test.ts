import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJsonReplay, sha256Hex } from "../src/replay/hash";

describe("replay/hash", () => {
  it("matches node:crypto sha256 for a range of inputs", () => {
    const inputs = ["", "a", "hello world", "x".repeat(1000), "x".repeat(500_000), JSON.stringify({ z: 1, a: [3, 2, 1] })];
    for (const input of inputs) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
    }
  });

  it("hashes multi-byte UTF-8 content correctly", () => {
    const input = "distortion — 混乱 — 🔥";
    expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
  });

  it("canonicalJsonReplay sorts object keys deeply and independent of insertion order", () => {
    const a = canonicalJsonReplay({ b: 1, a: { d: 2, c: [3, 1, 2] } });
    const b = canonicalJsonReplay({ a: { c: [3, 1, 2], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":[3,1,2],"d":2},"b":1}');
  });

  it("canonicalJsonReplay does not sort array element order", () => {
    expect(canonicalJsonReplay([3, 1, 2])).toBe("[3,1,2]");
  });
});

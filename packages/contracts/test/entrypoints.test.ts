import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as publicEntry from "../src/index.js";
import * as truthEntry from "../src/truth-entry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};

/**
 * Audit finding P1-09: the README claimed "no player-facing code can import or
 * receive truth", but the only package entry point re-exported `./truth.js`,
 * so any workspace depending on `@null-city/contracts` could name a truth
 * symbol. The boundary is now a resolution boundary: `.` is public-only and
 * truth lives behind the `./truth` subpath.
 *
 * These assertions fail on the inherited barrel.
 */
const TRUTH_ONLY_RUNTIME_EXPORTS = ["asTruthEvent", "eventHash", "verifyEventStream", "verifyEventChain", "EVENT_KINDS"];

describe("contracts entry points", () => {
  it("main entry exports no truth-only runtime symbol", () => {
    const names = Object.keys(publicEntry);
    const leaked = TRUTH_ONLY_RUNTIME_EXPORTS.filter((name) => names.includes(name));
    expect(leaked).toEqual([]);
  });

  it("main entry still exports the public player contract", () => {
    expect(typeof publicEntry.verifyPlayerEventStream).toBe("function");
    expect(typeof publicEntry.playerEventHash).toBe("function");
    expect(typeof publicEntry.canonicalJson).toBe("function");
    expect(typeof publicEntry.validatePlayerEventPayload).toBe("function");
  });

  it("truth subpath exposes truth verification and truth tagging", () => {
    for (const name of TRUTH_ONLY_RUNTIME_EXPORTS) {
      expect(Object.keys(truthEntry), name).toContain(name);
    }
    expect(typeof truthEntry.validateTruthEventPayload).toBe("function");
  });

  it("package exports map keeps truth on a separate subpath", () => {
    expect(Object.keys(PKG.exports).sort()).toEqual([".", "./public", "./truth"]);
    expect(JSON.stringify(PKG.exports["."])).not.toContain("truth-entry");
    expect(JSON.stringify(PKG.exports["./truth"])).toContain("truth-entry");
  });
});

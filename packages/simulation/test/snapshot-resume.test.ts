import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "../src/index.js";
import {
  parseSnapshot,
  saveSnapshotAtomically,
  loadSnapshotFromFile,
  validateSnapshot,
  serializeSnapshot,
} from "../src/snapshot.js";

function runToTick(tick: number) {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "resume" });
  runScript(engine, goldenScript());
  while (engine.currentTick < tick && engine.step()) {
    // advance
  }
  return engine;
}

describe("snapshot / resume", () => {
  it("resuming from an in-memory snapshot matches an uninterrupted run", () => {
    const snapshot = runToTick(200).snapshot();
    const resumed = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "resume", resume: snapshot });
    const direct = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "resume" });
    runScript(direct, goldenScript());
    while (direct.currentTick < 200 && direct.step()) {
      // advance
    }
    const rest = goldenScript().filter((c) => c.atTick >= 201);
    runScript(resumed, rest);
    runScript(direct, rest);
    resumed.runToEnd();
    direct.runToEnd();
    expect(resumed.eventLogHash).toBe(direct.eventLogHash);
    expect(resumed.finalStateDigest()).toBe(direct.finalStateDigest());
    expect(resumed.worldState.score.total).toBe(direct.worldState.score.total);
  });

  it("saves atomically, loads and validates the snapshot file", () => {
    const dir = mkdtempSync(join(tmpdir(), "null-city-snapshot-"));
    const path = join(dir, "session.save");
    const engine = runToTick(200);
    saveSnapshotAtomically(path, engine.snapshot());

    // a temp file must not be left behind after a successful save
    expect(existsSync(`${path}.tmp`)).toBe(false);

    const loaded = loadSnapshotFromFile(path);
    expect(loaded.sessionId).toBe("resume");
    expect(loaded.tick).toBe(200);

    const resumed = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "resume", resume: loaded });
    const direct = runToTick(200);
    runScript(resumed, goldenScript().filter((c) => c.atTick >= 201));
    runScript(direct, goldenScript().filter((c) => c.atTick >= 201));
    resumed.runToEnd();
    direct.runToEnd();
    expect(resumed.eventLogHash).toBe(direct.eventLogHash);

    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips through serializeSnapshot / parseSnapshot", () => {
    const data = runToTick(100).snapshot();
    const parsed = parseSnapshot(serializeSnapshot(data));
    expect(parsed.tick).toBe(100);
    expect(parsed.prngState).toBe(data.prngState);
    expect(parsed.events).toHaveLength(data.events.length);
  });

  it("validateSnapshot rejects corrupted snapshots", () => {
    const data = runToTick(100).snapshot();
    data.events = data.events.slice(0, 10);
    expect(() => validateSnapshot(data)).toThrow();
  });

  it("validateSnapshot rejects a tampered event payload", () => {
    const data = runToTick(100).snapshot();
    const idx = Math.floor(data.events.length / 2);
    const target = data.events[idx]!;
    data.events[idx] = {
      ...target,
      payload: { ...(target.payload as Record<string, unknown>), reason: "tampered" },
    };
    expect(() => validateSnapshot(data)).toThrow();
  });

  it("parseSnapshot rejects invalid JSON", () => {
    expect(() => parseSnapshot("not json")).toThrow();
  });

  it("parseSnapshot rejects foreign snapshot formats", () => {
    expect(() => parseSnapshot(JSON.stringify({ format: "other", version: 99 }))).toThrow();
  });
});
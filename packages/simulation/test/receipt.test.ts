import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import {
  SimulationEngine,
  buildRunReceipt,
  saveReceipt,
  loadReceipt,
  verifyReceipt,
  toPlayerEventLog,
} from "../src/index.js";

describe("run receipt", () => {
  it("builds, saves, and independently verifies a Black River receipt", () => {
    const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId: "receipt-1" });
    runScript(engine, goldenScript());
    const result = engine.runToEnd();
    const receipt = buildRunReceipt({
      result,
      events: engine.eventLog,
      playerEvents: toPlayerEventLog(engine.eventLog),
    });
    expect(verifyReceipt(receipt).ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "null-city-receipt-"));
    const path = join(dir, "run.receipt.json");
    saveReceipt(path, receipt);
    const loaded = loadReceipt(path);
    expect(verifyReceipt(loaded).ok).toBe(true);

    loaded.events[0]!.payload = { ...(loaded.events[0]!.payload as object), tampered: true };
    expect(verifyReceipt(loaded).ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

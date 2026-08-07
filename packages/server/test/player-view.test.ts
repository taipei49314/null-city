import { describe, expect, it } from "vitest";
import { blackRiver } from "@null-city/test-fixtures";
import { projectPlayerState } from "@null-city/epistemics";
import { SessionHub } from "../src/hub.js";

describe("public player projection via hub", () => {
  it("starts with teams/routes and no claims before any report", () => {
    const hub = new SessionHub(() => blackRiver());
    const record = hub.create({ scenarioId: "black-river", seed: 100, sessionId: "view-1" });
    const state = projectPlayerState(record.bridge.playerEvents);
    expect(state.stream).toBe("player");
    expect(state.claims).toEqual([]);
    expect(state.teams.length).toBe(8);
    expect(state.routes.length).toBeGreaterThan(0);
  });

  it("creates claims only after observation delivery", () => {
    const hub = new SessionHub(() => blackRiver());
    const record = hub.create({ scenarioId: "black-river", seed: 100, sessionId: "view-2" });
    const before = record.engine.eventLog.length;
    while (record.engine.currentTick < 25 && record.engine.step()) {
      // advance
    }
    hub.publishTruthDelta(record, before);
    const state = projectPlayerState(record.bridge.playerEvents);
    expect(state.claims.length).toBeGreaterThan(0);
    expect(state.evidence.length).toBeGreaterThan(0);
    for (const claim of state.claims) {
      expect(["reported", "corroborated", "contested"]).toContain(claim.status);
      expect(claim.asOfTick).toBeGreaterThan(0);
    }
  });

  it("never embeds exact district truth attributes in public state", () => {
    const hub = new SessionHub(() => blackRiver());
    const record = hub.create({ scenarioId: "black-river", seed: 100, sessionId: "view-3" });
    const before = record.engine.eventLog.length;
    while (record.engine.currentTick < 30 && record.engine.step()) {
      // advance
    }
    hub.publishTruthDelta(record, before);
    const state = projectPlayerState(record.bridge.playerEvents);
    const text = JSON.stringify(state);
    expect(text).not.toContain('"power":');
    expect(text).not.toContain("TrueIncidentOccurred");
    expect(text).not.toContain("corruptionType");
  });
});

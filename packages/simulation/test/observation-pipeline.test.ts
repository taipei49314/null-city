import { describe, expect, it } from "vitest";
import { validateScenario, type Scenario } from "@null-city/scenario-schema";
import { SimulationEngine } from "../src/index.js";
import type { ObservationDef } from "@null-city/scenario-schema";

export interface MinimalOptions {
  communications?: number;
  observations?: ObservationDef[];
  seed?: number;
}

/** minimal 2-district scenario used to isolate pipeline behaviour */
export function minimalScenario(options: MinimalOptions = {}): Scenario {
  const observations = options.observations ?? [
    {
      id: "obs-1",
      incidentId: "test_fire",
      sourceId: "sensor-a",
      atTick: 5,
      baseDelayTicks: 10,
      degradedDelayMultiplier: 1,
      lossProbability: 0,
      relativeToIncidentStart: false,
      content: "fire at central",
      category: "telemetry",
    },
  ];
  return validateScenario({
    schemaVersion: 1,
    id: "minimal",
    name: "Minimal",
    tickDurationSeconds: 10,
    totalTicks: 100,
    districts: [
      {
        id: "central",
        power: 95,
        communications: options.communications ?? 90,
        water: 90,
        traffic: 80,
        medicalCapacity: 85,
        hazardLevel: 5,
        populationRisk: 10,
      },
      { id: "north", power: 95, communications: 90, water: 90, traffic: 80, medicalCapacity: 85, hazardLevel: 5, populationRisk: 10 },
    ],
    teams: [
      { teamId: "fire-1", type: "fire", startDistrict: "central", reschedulable: true },
      { teamId: "verify-1", type: "verification", startDistrict: "central", reschedulable: true },
      { teamId: "comms-1", type: "communications", startDistrict: "central", reschedulable: true },
    ],
    routes: [{ id: "central-north", from: "central", to: "north", travelTicks: 2, capacity: 100 }],
    resources: { backupGenerators: 1, advisoryUses: 1 },
    incidents: [
      {
        id: "test_fire",
        kind: "fire",
        district: "central",
        atTick: 5,
        severity: 40,
        effect: { attribute: "hazardLevel", delta: 3 },
        handledBy: ["hazard_control"],
      },
    ],
    effects: [],
    sources: [
      { id: "sensor-a", kind: "sensor", reliability: 0.9 },
      { id: "citizen", kind: "public", reliability: 0.3 },
    ],
    observations,
  });
}

export function runUntil(engine: SimulationEngine, tick: number): void {
  while (engine.currentTick < tick && engine.step()) {
    // advance
  }
}

/** narrow a contract event payload to a dictionary for assertion reading */
function payload(e: { payload: unknown }): Record<string, unknown> {
  return e.payload as Record<string, unknown>;
}

describe("observation pipeline", () => {
  it("delivers an observation after its base delay", () => {
    const engine = new SimulationEngine({
      scenario: minimalScenario(),
      seed: 100,
      sessionId: "obs-delay",
    });
    runUntil(engine, 5);
    expect(engine.deliveredObservations.length).toBe(0);
    runUntil(engine, 15);
    const delivered = engine.deliveredObservations.filter((o) => o.observationId.includes("obs-1"));
    expect(delivered).toHaveLength(1);
    const delayEvents = engine.eventLog.filter(
      (e) => e.kind === "ObservationDelayed" && String(payload(e)["observationId"]).includes("obs-1"),
    );
    expect(delayEvents.length).toBeGreaterThan(0);
    expect(payload(delayEvents[0]!)["delayTicks"]).toBe(10);
    const deliveredEvent = engine.eventLog.find(
      (e) => e.kind === "ObservationDelivered" && String(payload(e)["observationId"]).includes("obs-1"),
    );
    expect(deliveredEvent && payload(deliveredEvent)["deliveredTick"]).toBe(15);
  });

  it("keeps delaying in-flight reports while the channel stays down, then delivers after comms repair", () => {
    const def: ObservationDef = {
      id: "obs-degraded",
      incidentId: "test_fire",
      sourceId: "sensor-a",
      atTick: 5,
      baseDelayTicks: 10,
      degradedDelayMultiplier: 3,
      lossProbability: 0,
      relativeToIncidentStart: false,
      content: "degraded channel report",
      category: "telemetry",
    };
    const engine = new SimulationEngine({
      scenario: minimalScenario({ communications: 20, observations: [def] }),
      seed: 100,
      sessionId: "obs-degraded",
    });
    runUntil(engine, 5);
    const created = engine.eventLog.find(
      (e) => e.kind === "ObservationDelayed" && String(payload(e)["observationId"]).includes("obs-degraded"),
    );
    expect(created && payload(created)["delayTicks"]).toBe(30);

    // while the channel stays down the report keeps sliding and never arrives
    runUntil(engine, 35);
    expect(engine.deliveredObservations.some((o) => o.observationId.includes("obs-degraded"))).toBe(false);
    const slid = engine.eventLog.some(
      (e) => e.kind === "ObservationDelayed" && e.tick > 5 && String(payload(e)["observationId"]).includes("obs-degraded"),
    );
    expect(slid, "in-flight reports must be re-delayed while comms < 30").toBe(true);

    // repairing the channel lets the pending report through once the slide stops
    engine.submitCommand("DISPATCH_TEAM", { teamId: "comms-1", target: "central", task: "comms_repair" }, "degraded-comms");
    runUntil(engine, 45);
    expect(engine.worldState.districts["central"]!.communications).toBeGreaterThanOrEqual(30);
    // the report was pushed far out by the sliding delay; it must still arrive
    runUntil(engine, 90);
    expect(engine.deliveredObservations.some((o) => o.observationId.includes("obs-degraded"))).toBe(true);
  });

  it("applies corruption with probability 1 and marks the report false", () => {
    const def: ObservationDef = {
      id: "obs-corrupt",
      incidentId: "test_fire",
      sourceId: "citizen",
      atTick: 5,
      baseDelayTicks: 0,
      degradedDelayMultiplier: 1,
      lossProbability: 0,
      relativeToIncidentStart: false,
      content: "true report",
      category: "witness",
      corruption: [
        { probability: 1, type: "exaggerated", text: "MASSIVE blaze", false: true },
      ],
    };
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: [def] }),
      seed: 100,
      sessionId: "obs-corrupt",
    });
    runUntil(engine, 5);
    const corruptEvent = engine.eventLog.find(
      (e) => e.kind === "ObservationCorrupted" && String(payload(e)["observationId"]).includes("obs-corrupt"),
    );
    expect(corruptEvent).toBeDefined();
    expect(corruptEvent && payload(corruptEvent)["corrupted"]).toBe("MASSIVE blaze");
    expect(corruptEvent && payload(corruptEvent)["false"]).toBe(true);
    runUntil(engine, 6);
    const delivered = engine.deliveredObservations.find((o) => o.observationId.includes("obs-corrupt"));
    expect(delivered?.content).toBe("MASSIVE blaze");
    expect(delivered?.false).toBe(true);
  });

  it("does not corrupt when corruption probability is zero", () => {
    const def: ObservationDef = {
      id: "obs-clean",
      incidentId: "test_fire",
      sourceId: "sensor-a",
      atTick: 5,
      baseDelayTicks: 0,
      degradedDelayMultiplier: 1,
      lossProbability: 0,
      relativeToIncidentStart: false,
      content: "clean report",
      category: "telemetry",
      corruption: [{ probability: 0, type: "exaggerated", text: "never used", false: true }],
    };
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: [def] }),
      seed: 100,
      sessionId: "obs-clean",
    });
    runUntil(engine, 6);
    const delivered = engine.deliveredObservations.find((o) => o.observationId.includes("obs-clean"));
    expect(delivered?.content).toBe("clean report");
    expect(delivered?.false).toBe(false);
  });

  it("loses an observation with probability 1 and never delivers it", () => {
    const def: ObservationDef = {
      id: "obs-lost",
      incidentId: "test_fire",
      sourceId: "sensor-a",
      atTick: 5,
      baseDelayTicks: 2,
      degradedDelayMultiplier: 1,
      lossProbability: 1,
      relativeToIncidentStart: false,
      content: "will be lost",
      category: "telemetry",
    };
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: [def] }),
      seed: 100,
      sessionId: "obs-lost",
    });
    runUntil(engine, 5);
    const lostEvent = engine.eventLog.find(
      (e) => e.kind === "ObservationLost" && String(payload(e)["observationId"]).includes("obs-lost"),
    );
    expect(lostEvent).toBeDefined();
    expect(lostEvent && payload(lostEvent)["reason"]).toBe("transmission_lost");
    runUntil(engine, 99);
    expect(engine.deliveredObservations.some((o) => o.observationId.includes("obs-lost"))).toBe(false);
  });

  it("drops stale observations that arrive too late", () => {
    const def: ObservationDef = {
      id: "obs-stale",
      incidentId: "test_fire",
      sourceId: "sensor-a",
      atTick: 5,
      baseDelayTicks: 30,
      degradedDelayMultiplier: 1,
      staleAfterTicks: 10,
      lossProbability: 0,
      relativeToIncidentStart: false,
      content: "too old to matter",
      category: "telemetry",
    };
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: [def] }),
      seed: 100,
      sessionId: "obs-stale",
    });
    runUntil(engine, 40);
    const staleEvent = engine.eventLog.find(
      (e) => e.kind === "ObservationLost" && String(payload(e)["observationId"]).includes("obs-stale"),
    );
    expect(staleEvent && payload(staleEvent)["reason"]).toBe("outdated_by_timeout");
    expect(engine.deliveredObservations.some((o) => o.observationId.includes("obs-stale"))).toBe(false);
  });

  it("delivers duplicate reports as separate observations of the same incident", () => {
    const defs: ObservationDef[] = [
      {
        id: "dup-a",
        incidentId: "test_fire",
        sourceId: "sensor-a",
        atTick: 5,
        baseDelayTicks: 0,
        degradedDelayMultiplier: 1,
        lossProbability: 0,
        relativeToIncidentStart: false,
        content: "report A",
        category: "telemetry",
      },
      {
        id: "dup-b",
        incidentId: "test_fire",
        sourceId: "citizen",
        atTick: 5,
        baseDelayTicks: 1,
        degradedDelayMultiplier: 1,
        lossProbability: 0,
        relativeToIncidentStart: false,
        content: "report B",
        category: "witness",
      },
    ];
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: defs }),
      seed: 100,
      sessionId: "obs-dup",
    });
    runUntil(engine, 6);
    const delivered = engine.deliveredObservations.filter((o) => o.incidentId === "test_fire");
    expect(delivered).toHaveLength(2);
    expect(delivered[0]!.content).toBe("report A");
    expect(delivered[1]!.content).toBe("report B");
  });

  it("marks delivered observations verified while the verification team is on site", () => {
    const defs: ObservationDef[] = [
      {
        id: "obs-v",
        incidentId: "test_fire",
        sourceId: "citizen",
        atTick: 5,
        baseDelayTicks: 2,
        degradedDelayMultiplier: 1,
        lossProbability: 0,
        relativeToIncidentStart: false,
        content: "unverified claim",
        category: "witness",
      },
    ];
    const engine = new SimulationEngine({
      scenario: minimalScenario({ observations: defs }),
      seed: 100,
      sessionId: "obs-verify",
    });
    engine.submitCommand("DISPATCH_TEAM", { teamId: "verify-1", target: "central", task: "verify" }, "v-1");
    runUntil(engine, 7);
    const delivered = engine.deliveredObservations.find((o) => o.observationId.includes("obs-v"));
    expect(delivered).toBeDefined();
    expect(delivered!.verified).toBe(true);
  });
});
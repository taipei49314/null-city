import { describe, expect, it } from "vitest";
import { playerEventHash, type PlayerEventEnvelope } from "@null-city/contracts";
import { applyPlayerEvent, emptyPlayerState, projectPlayerState } from "../src/project.js";
import { PlayerEventStore } from "../src/store.js";
import { claimIdFor, normalizeObservationToEvidence, upsertClaimFromEvidence } from "../src/claims.js";

function sealed(
  sessionId: string,
  sequence: number,
  tick: number,
  kind: PlayerEventEnvelope["kind"],
  payload: unknown,
  previousHash: string,
): PlayerEventEnvelope {
  const envelope: PlayerEventEnvelope = {
    stream: "player",
    sessionId,
    sequence,
    tick,
    kind,
    payload,
    previousHash,
    hash: "",
  };
  envelope.hash = playerEventHash(envelope);
  return envelope;
}

describe("player projection", () => {
  it("rebuilds identical state from the event log", () => {
    const store = new PlayerEventStore();
    store.append("s1", 0, "SessionStarted", {
      scenarioId: "black-river",
      seed: 1,
      totalTicks: 540,
      teams: [],
      routes: [],
      resources: { backupGenerators: 3, advisoryUses: 3 },
    });
    const claimId = claimIdFor("substation_fault", "power", "industrial");
    const evidence = normalizeObservationToEvidence(
      {
        observationId: "obs-1",
        incidentId: "substation_fault",
        sourceId: "grid",
        observedTick: 10,
        content: "power drop",
        category: "power",
        reliability: 0.8,
        districtId: "industrial",
      },
      12,
      claimId,
    );
    store.append("s1", 12, "EvidenceRecorded", { evidence });
    const { claim } = upsertClaimFromEvidence(undefined, evidence, {
      observationId: "obs-1",
      incidentId: "substation_fault",
      sourceId: "grid",
      observedTick: 10,
      content: "power drop",
      category: "power",
      reliability: 0.8,
      districtId: "industrial",
    }, 12);
    store.append("s1", 12, "ClaimUpdated", { claim, reason: "reported" });

    const live = projectPlayerState(store.log);
    let rebuilt = emptyPlayerState("s1");
    for (const event of store.log) {
      rebuilt = applyPlayerEvent(rebuilt, event);
    }
    rebuilt.playerEventCount = store.log.length;
    rebuilt.playerLogHash = store.tipHash;
    expect(rebuilt).toEqual(live);
    expect(live.claims[0]?.status).toBe("reported");
    expect(live.evidence[0]?.content).toBe("power drop");
  });

  it("corroborates and contests claims from public evidence only", () => {
    const claimId = claimIdFor("x", "power", "central");
    const e1 = normalizeObservationToEvidence(
      {
        observationId: "a",
        incidentId: "x",
        sourceId: "s1",
        observedTick: 1,
        content: "low power",
        category: "power",
        reliability: 0.7,
        districtId: "central",
      },
      2,
      claimId,
    );
    const first = upsertClaimFromEvidence(undefined, e1, {
      observationId: "a",
      incidentId: "x",
      sourceId: "s1",
      observedTick: 1,
      content: "low power",
      category: "power",
      reliability: 0.7,
      districtId: "central",
    }, 2);
    expect(first.reason).toBe("reported");

    const e2 = normalizeObservationToEvidence(
      {
        observationId: "b",
        incidentId: "x",
        sourceId: "s2",
        observedTick: 3,
        content: "low power",
        category: "power",
        reliability: 0.6,
        districtId: "central",
      },
      4,
      claimId,
    );
    const second = upsertClaimFromEvidence(first.claim, e2, {
      observationId: "b",
      incidentId: "x",
      sourceId: "s2",
      observedTick: 3,
      content: "low power",
      category: "power",
      reliability: 0.6,
      districtId: "central",
    }, 4);
    expect(second.reason).toBe("corroborated");

    const e3 = normalizeObservationToEvidence(
      {
        observationId: "c",
        incidentId: "x",
        sourceId: "s3",
        observedTick: 5,
        content: "power fine",
        category: "power",
        reliability: 0.5,
        districtId: "central",
      },
      6,
      claimId,
    );
    const third = upsertClaimFromEvidence(second.claim, e3, {
      observationId: "c",
      incidentId: "x",
      sourceId: "s3",
      observedTick: 5,
      content: "power fine",
      category: "power",
      reliability: 0.5,
      districtId: "central",
    }, 6);
    expect(third.reason).toBe("contested");
  });

  it("sealed helper produces verifiable player hashes", () => {
    const event = sealed("s", 0, 0, "SessionStarted", {
      scenarioId: "x",
      seed: 1,
      totalTicks: 1,
      teams: [],
      routes: [],
      resources: { backupGenerators: 0, advisoryUses: 0 },
    }, "");
    expect(event.hash).toHaveLength(64);
  });
});

import type { Claim, ClaimStatus, Evidence } from "@null-city/contracts";

export function claimIdFor(incidentHint: string, category: string, districtId: string): string {
  return `claim:${districtId}:${incidentHint}:${category}`;
}

export function evidenceIdFor(observationId: string): string {
  return `evidence:${observationId}`;
}

export interface ObservationPublicFacts {
  observationId: string;
  incidentId: string;
  sourceId: string;
  observedTick: number;
  content: string;
  category: string;
  reliability: number;
  districtId: string;
  /** Never expose to players; used only when verification resolves. */
  internallyFalse?: boolean;
}

export function normalizeObservationToEvidence(
  facts: ObservationPublicFacts,
  deliveredTick: number,
  claimId: string,
): Evidence {
  return {
    id: evidenceIdFor(facts.observationId),
    claimId,
    sourceId: facts.sourceId,
    observedTick: facts.observedTick,
    deliveredTick,
    content: facts.content,
    category: facts.category,
    reliability: facts.reliability,
    verified: false,
  };
}

export function upsertClaimFromEvidence(
  existing: Claim | undefined,
  evidence: Evidence,
  facts: ObservationPublicFacts,
  tick: number,
): { claim: Claim; reason: ClaimStatus | "updated" | "reported" } {
  if (!existing) {
    return {
      claim: {
        id: evidence.claimId,
        subject: facts.districtId,
        predicate: facts.category,
        value: facts.content,
        districtId: facts.districtId as Claim["districtId"],
        incidentHint: facts.incidentId,
        firstObservedTick: facts.observedTick,
        lastUpdatedTick: tick,
        status: "reported",
        evidenceIds: [evidence.id],
        asOfTick: tick,
      },
      reason: "reported",
    };
  }

  const evidenceIds = existing.evidenceIds.includes(evidence.id)
    ? existing.evidenceIds
    : [...existing.evidenceIds, evidence.id];
  const sameValue = existing.value === facts.content;
  let status: ClaimStatus = existing.status;
  let reason: ClaimStatus | "updated" | "reported" = "updated";

  if (existing.status === "verified" || existing.status === "refuted") {
    // Terminal statuses stay unless new contradiction arrives before verification — keep.
  } else if (!sameValue && existing.status !== "stale") {
    status = "contested";
    reason = "contested";
  } else if (sameValue && evidenceIds.length >= 2 && existing.status === "reported") {
    status = "corroborated";
    reason = "corroborated";
  }

  return {
    claim: {
      ...existing,
      value: sameValue ? existing.value : facts.content,
      lastUpdatedTick: tick,
      status,
      evidenceIds,
      asOfTick: tick,
    },
    reason,
  };
}

export function markClaimStale(claim: Claim, tick: number): Claim {
  if (claim.status === "verified" || claim.status === "refuted") {
    return claim;
  }
  return { ...claim, status: "stale", lastUpdatedTick: tick, asOfTick: tick };
}

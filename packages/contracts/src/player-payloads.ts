import { z } from "zod";

import type { PlayerEventKind } from "./public.js";
import {
  describeIssue,
  finiteNumber,
  nonEmptyString,
  nullableTickSchema,
  tickSchema,
} from "./payload-util.js";

/**
 * Discriminated runtime schemas for the player event stream.
 *
 * Same rationale as `truth-payloads.ts`: the inherited verifier accepted any
 * non-null object (including arrays) for any kind. These schemas are the
 * runtime half of the public contract a benchmark client or SDK consumer
 * relies on.
 */

const publicResourcesSchema = z.object({
  backupGenerators: z.number().int().min(0),
  advisoryUses: z.number().int().min(0),
});

const ownTeamSchema = z.object({
  teamId: nonEmptyString,
  type: nonEmptyString,
  location: nonEmptyString,
  status: nonEmptyString,
  etaTick: nullableTickSchema,
  orderTarget: z.string().nullable(),
  orderTask: z.string().nullable(),
});

const knownRouteSchema = z.object({
  id: nonEmptyString,
  closed: z.boolean(),
  knownClosedAtTick: nullableTickSchema,
});

const evidenceSchema = z.object({
  id: nonEmptyString,
  claimId: nonEmptyString,
  sourceId: nonEmptyString,
  observedTick: tickSchema,
  deliveredTick: tickSchema,
  content: z.string(),
  category: nonEmptyString,
  reliability: finiteNumber,
  verified: z.boolean(),
});

const claimSchema = z.object({
  id: nonEmptyString,
  subject: z.string(),
  predicate: z.string(),
  firstObservedTick: tickSchema,
  lastUpdatedTick: tickSchema,
  status: z.enum(["reported", "corroborated", "contested", "verified", "refuted", "stale"]),
  evidenceIds: z.array(nonEmptyString),
  asOfTick: tickSchema,
});

const assessmentSchema = z.object({
  id: nonEmptyString,
  claimId: nonEmptyString,
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  submittedTick: tickSchema,
});

const PLAYER_PAYLOAD_SCHEMAS: Record<PlayerEventKind, z.ZodTypeAny> = {
  SessionStarted: z.object({
    scenarioId: nonEmptyString,
    seed: z.number().int(),
    totalTicks: z.number().int().min(1),
    teams: z.array(ownTeamSchema),
    routes: z.array(knownRouteSchema),
    resources: publicResourcesSchema,
  }),
  EvidenceRecorded: z.object({ evidence: evidenceSchema }),
  ClaimUpdated: z.object({
    claim: claimSchema,
    reason: z.enum([
      "reported",
      "corroborated",
      "contested",
      "verified",
      "refuted",
      "stale",
      "updated",
    ]),
  }),
  AssessmentSubmitted: z.object({ assessment: assessmentSchema }),
  VerificationResolved: z.object({
    claimId: nonEmptyString,
    teamId: nonEmptyString,
    outcome: z.enum(["verified", "refuted", "inconclusive"]),
    resolvedTick: tickSchema,
  }),
  CommandResult: z.object({
    commandId: nonEmptyString,
    commandName: nonEmptyString,
    idempotencyKey: nonEmptyString,
    state: z.enum(["accepted", "rejected"]),
    errorCode: z.string().nullable(),
    detail: z.string().nullable(),
    etaTick: nullableTickSchema,
    target: z.string(),
  }),
  OwnTeamUpdated: z.object({ team: ownTeamSchema }),
  KnownRouteUpdated: z.object({ route: knownRouteSchema }),
  PublicScoreChanged: z.object({
    delta: finiteNumber,
    reason: z.string(),
    category: nonEmptyString,
    total: finiteNumber,
  }),
  ResourcesChanged: z.object({ resources: publicResourcesSchema }),
  RunCompleted: z.object({
    finalTick: tickSchema,
    scoreTotal: finiteNumber,
    claimCount: z.number().int().min(0),
    evidenceCount: z.number().int().min(0),
  }),
};

export class PlayerPayloadSchemaError extends Error {}

/** Returns a machine-readable reason, or null when the payload is valid. */
export function validatePlayerEventPayload(kind: string, payload: unknown): string | null {
  const schema = PLAYER_PAYLOAD_SCHEMAS[kind as PlayerEventKind];
  if (!schema) {
    return `unknown_kind:${kind}`;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return `invalid_payload:${kind}:expected a non-array object`;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return `invalid_payload:${kind}:${describeIssue(parsed.error)}`;
  }
  return null;
}

export function assertPlayerEventPayload(kind: string, payload: unknown): void {
  const reason = validatePlayerEventPayload(kind, payload);
  if (reason !== null) {
    throw new PlayerPayloadSchemaError(reason);
  }
}

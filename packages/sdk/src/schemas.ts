import { z } from "zod";

/**
 * Runtime schemas for the public wire contract. These mirror
 * `@null-city/contracts`'s `public.ts` structurally rather than importing
 * its types as zod schemas (contracts does not ship zod schemas for the
 * public surface), so the SDK never trusts a server response merely
 * because a TypeScript cast says it has the right shape.
 *
 * Every schema is intentionally permissive on unknown *extra* fields
 * (`.passthrough()` is avoided in favor of `.strip()` defaults) but strict
 * on the fields the SDK actually depends on, so a server that adds new
 * public fields does not break older SDK versions, while missing/renamed
 * required fields fail loudly instead of silently producing `undefined`.
 */

const tick = z.number().int().nonnegative();

export const claimStatusSchema = z.enum(["reported", "corroborated", "contested", "verified", "refuted", "stale"]);

export const evidenceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  sourceId: z.string(),
  observedTick: tick,
  deliveredTick: tick,
  content: z.string(),
  category: z.string(),
  reliability: z.number(),
  verified: z.boolean(),
});

export const claimSchema = z.object({
  id: z.string(),
  subject: z.string(),
  predicate: z.string(),
  value: z.unknown(),
  districtId: z.string().optional(),
  incidentHint: z.string().optional(),
  firstObservedTick: tick,
  lastUpdatedTick: tick,
  status: claimStatusSchema,
  evidenceIds: z.array(z.string()),
  asOfTick: tick,
});

export const assessmentSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
  submittedTick: tick,
});

export const ownTeamStateSchema = z.object({
  teamId: z.string(),
  type: z.string(),
  location: z.string(),
  status: z.string(),
  etaTick: tick.nullable(),
  orderTarget: z.string().nullable(),
  orderTask: z.string().nullable(),
});

export const knownRouteStateSchema = z.object({
  id: z.string(),
  closed: z.boolean(),
  knownClosedAtTick: tick.nullable(),
});

export const publicResourcesSchema = z.object({
  backupGenerators: z.number(),
  advisoryUses: z.number(),
});

export const publicScoreSchema = z.object({
  total: z.number(),
  recent: z.array(
    z.object({
      category: z.string(),
      delta: z.number(),
      reason: z.string(),
      tick,
    }),
  ),
});

export const playerSessionStateSchema = z.object({
  stream: z.literal("player"),
  sessionId: z.string(),
  scenarioId: z.string(),
  tick,
  phase: z.enum(["running", "completed"]),
  claims: z.array(claimSchema),
  evidence: z.array(evidenceSchema),
  assessments: z.array(assessmentSchema),
  teams: z.array(ownTeamStateSchema),
  routes: z.array(knownRouteStateSchema),
  resources: publicResourcesSchema,
  score: publicScoreSchema,
  playerEventCount: z.number().int().nonnegative(),
  playerLogHash: z.string(),
});

export const playerEventKindSchema = z.enum([
  "SessionStarted",
  "EvidenceRecorded",
  "ClaimUpdated",
  "AssessmentSubmitted",
  "VerificationResolved",
  "CommandResult",
  "OwnTeamUpdated",
  "KnownRouteUpdated",
  "PublicScoreChanged",
  "ResourcesChanged",
  "RunCompleted",
]);

export const playerEventEnvelopeSchema = z.object({
  stream: z.literal("player"),
  sessionId: z.string(),
  sequence: z.number().int().nonnegative(),
  tick,
  kind: playerEventKindSchema,
  payload: z.unknown(),
  previousHash: z.string(),
  hash: z.string(),
});

export const errorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const envelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: errorBodySchema.optional(),
});

export const commandValidationSchema = z.object({
  valid: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const commandResultBodySchema = z.object({
  sessionId: z.string(),
  commandId: z.string(),
  state: z.enum(["accepted", "rejected", "pending"]),
  etaTick: tick.nullable(),
  validation: commandValidationSchema,
  result: z.object({ ok: z.boolean(), detail: z.string() }).nullable(),
  events: z.array(playerEventEnvelopeSchema),
  publicState: playerSessionStateSchema,
});

export const advanceResultBodySchema = z.object({
  sessionId: z.string(),
  tick,
  advanced: z.number().int().nonnegative(),
  completed: z.boolean(),
  events: z.array(playerEventEnvelopeSchema),
  publicState: playerSessionStateSchema,
});

export const assessResultBodySchema = z.object({
  sessionId: z.string(),
  assessment: assessmentSchema,
  events: z.array(playerEventEnvelopeSchema),
  publicState: playerSessionStateSchema,
});

export const createSessionResultBodySchema = z.object({
  sessionId: z.string(),
  seed: z.number(),
  scenarioId: z.string(),
  tick,
  playerLogHash: z.string(),
  state: playerSessionStateSchema,
});

export const sessionStateResultBodySchema = z.object({
  sessionId: z.string(),
  scenarioId: z.string(),
  tick,
  phase: z.enum(["running", "completed"]),
  playerLogHash: z.string(),
  score: z.number(),
  state: playerSessionStateSchema,
});

export const eventsResultBodySchema = z.object({
  sessionId: z.string(),
  since: z.number().int().nonnegative(),
  next: z.number().int().nonnegative(),
  stream: z.literal("player"),
  events: z.array(playerEventEnvelopeSchema),
});

export const summaryResultBodySchema = z.object({
  sessionId: z.string(),
  scenarioId: z.string(),
  finalTick: tick,
  scoreTotal: z.number(),
  claimCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  assessmentCount: z.number().int().nonnegative(),
  playerLogHash: z.string(),
  claims: z.array(claimSchema),
});

export const deleteResultBodySchema = z.object({
  sessionId: z.string(),
  deleted: z.boolean(),
});

export const listResultBodySchema = z.object({
  sessions: z.array(z.string()),
});

import { z } from "zod";

import type { EventKindName } from "./events.js";
import {
  describeIssue,
  finiteNumber,
  nonEmptyString,
  nullableTickSchema,
  plainObject,
  tickSchema,
} from "./payload-util.js";

/**
 * Discriminated runtime schemas for the truth event stream.
 *
 * The inherited verifier only asserted `typeof payload === "object"`, which
 * accepted arrays and arbitrary shapes for any kind (audit findings P1-04 and
 * ART-04). These schemas bind each `kind` to the payload the engine actually
 * emits. They are deliberately non-strict about *additional* keys so a future
 * additive protocol change stays backward compatible, but every field listed
 * here is required and typed.
 */

const scoreBreakdownItemSchema = z.object({
  id: nonEmptyString,
  label: z.string(),
  delta: finiteNumber,
  tick: tickSchema,
  reason: z.string(),
});

export const scoreStateSchema = z.object({
  total: finiteNumber,
  finalPopulationRisk: finiteNumber,
  infrastructureAvailability: finiteNumber,
  eventsHandledPoints: finiteNumber,
  eventsMissedPoints: finiteNumber,
  misadvisoryCost: finiteNumber,
  wastedDispatchCost: finiteNumber,
  decisionDelayPoints: finiteNumber,
  resourceEfficiency: finiteNumber,
  chainFailurePenalty: finiteNumber,
  raw: z.object({
    incidentsHandled: z.number().int().min(0),
    incidentsMissed: z.number().int().min(0),
    chainedIncidents: z.number().int().min(0),
    wastedDispatchTicks: z.number().int().min(0),
    decisionDelayTicks: z.number().min(0),
    incidentsWithoutAction: z.number().int().min(0),
    remainingBackupGenerators: z.number().int().min(0),
    remainingAdvisories: z.number().int().min(0),
  }),
  breakdown: z.array(scoreBreakdownItemSchema),
});

const districtStateSchema = z.object({
  id: nonEmptyString,
  power: finiteNumber,
  communications: finiteNumber,
  water: finiteNumber,
  traffic: finiteNumber,
  medicalCapacity: finiteNumber,
  hazardLevel: finiteNumber,
  populationRisk: finiteNumber,
});

const TRUTH_PAYLOAD_SCHEMAS: Record<EventKindName, z.ZodTypeAny> = {
  ScenarioStarted: z.object({
    scenarioId: nonEmptyString,
    seed: z.number().int(),
    tickPerSimSecond: finiteNumber,
    totalTicks: z.number().int().min(1),
    districts: z.array(nonEmptyString).min(1),
  }),
  TrueIncidentOccurred: z.object({
    incidentId: nonEmptyString,
    kind: nonEmptyString,
    district: nonEmptyString,
    severity: finiteNumber,
  }),
  IncidentChained: z.object({
    incidentId: nonEmptyString,
    sourceIncidentId: nonEmptyString,
    district: nonEmptyString,
    severity: finiteNumber,
  }),
  IncidentResolved: z.object({
    incidentId: nonEmptyString,
    district: nonEmptyString,
    handledTick: tickSchema,
  }),
  ObservationCreated: z.object({
    observationId: nonEmptyString,
    incidentId: nonEmptyString,
    source: nonEmptyString,
    observedTick: tickSchema,
    content: z.string(),
    reliability: finiteNumber,
    category: nonEmptyString,
  }),
  ObservationDelayed: z.object({
    observationId: nonEmptyString,
    newDeliveryTick: tickSchema,
    delayTicks: z.number().int(),
  }),
  ObservationCorrupted: z.object({
    observationId: nonEmptyString,
    corruptionType: z.enum([
      "exaggerated",
      "understated",
      "mistaken_identity",
      "wrong_location",
      "attribution_error",
    ]),
    original: z.string(),
    corrupted: z.string(),
    false: z.boolean(),
  }),
  ObservationLost: z.object({
    observationId: nonEmptyString,
    reason: z.enum(["transmission_lost", "outdated_by_timeout"]),
  }),
  ObservationDelivered: z.object({
    observationId: nonEmptyString,
    deliveredTick: tickSchema,
  }),
  CommandIssued: z.object({
    commandId: nonEmptyString,
    commandName: nonEmptyString,
    idempotencyKey: nonEmptyString,
    issuedTick: tickSchema,
    target: z.string().nullable(),
    params: plainObject,
  }),
  CommandRejected: z.object({
    commandId: nonEmptyString,
    reason: z.string(),
    code: nonEmptyString,
  }),
  CommandAccepted: z.object({
    commandId: nonEmptyString,
    idempotencyKey: nonEmptyString,
    etaTick: nullableTickSchema,
  }),
  TeamDispatched: z.object({
    teamId: nonEmptyString,
    orderId: nonEmptyString,
    from: nonEmptyString,
    to: nonEmptyString,
    travelTicks: z.number().int().min(0),
    etaTick: tickSchema,
  }),
  TeamArrived: z.object({
    teamId: nonEmptyString,
    orderId: z.string(),
    district: nonEmptyString,
  }),
  ActionApplied: z.object({
    action: nonEmptyString,
    target: nonEmptyString,
    attribute: nonEmptyString,
    delta: finiteNumber,
    result: finiteNumber,
  }),
  SystemStateChanged: z.object({
    districts: z.record(districtStateSchema),
    teams: z.array(
      z.object({
        teamId: nonEmptyString,
        status: nonEmptyString,
        location: nonEmptyString,
        etaTick: nullableTickSchema,
        order: plainObject.nullable(),
      }),
    ),
    routes: z.record(z.object({ closed: z.boolean() })),
    resources: z.object({
      backupGenerators: z.number().int().min(0),
      advisoryUses: z.number().int().min(0),
    }),
  }),
  ScoreChanged: z.object({
    delta: finiteNumber,
    reason: z.string(),
    category: nonEmptyString,
    total: finiteNumber,
  }),
  ScenarioCompleted: z.object({
    finalScore: scoreStateSchema,
    finalTick: tickSchema,
  }),
};

export class TruthPayloadSchemaError extends Error {}

/**
 * Validates one truth event payload against the schema for its kind.
 * Returns a machine-readable reason string instead of throwing so stream
 * verification can report `brokenAt`.
 */
export function validateTruthEventPayload(kind: string, payload: unknown): string | null {
  const schema = TRUTH_PAYLOAD_SCHEMAS[kind as EventKindName];
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

export function assertTruthEventPayload(kind: string, payload: unknown): void {
  const reason = validateTruthEventPayload(kind, payload);
  if (reason !== null) {
    throw new TruthPayloadSchemaError(reason);
  }
}

/**
 * Clean-room runtime payload validation for Replay Lab.
 *
 * Deliberately does not import `@null-city/contracts` at runtime (its public
 * entry re-exports Node `canonical` helpers) or `@null-city/contracts/truth`.
 * Field requirements mirror the public player / truth payload contracts.
 */
import { MAX_ARRAY_LENGTH, MAX_OBJECT_KEYS, MAX_STRING_LENGTH } from "./bounds";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(reason: string): string {
  return reason;
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string | null {
  const value = obj[key];
  if (typeof value !== "string") {
    return fail(`${where}.${key}: expected string`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    return fail(`${where}.${key}: string exceeds ${MAX_STRING_LENGTH} chars`);
  }
  return null;
}

function requireNonEmptyString(obj: Record<string, unknown>, key: string, where: string): string | null {
  const err = requireString(obj, key, where);
  if (err) return err;
  if ((obj[key] as string).length === 0) {
    return fail(`${where}.${key}: expected non-empty string`);
  }
  return null;
}

function requireFiniteNumber(obj: Record<string, unknown>, key: string, where: string): string | null {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${where}.${key}: expected finite number`);
  }
  return null;
}

function requireInt(obj: Record<string, unknown>, key: string, where: string, min = 0): string | null {
  const err = requireFiniteNumber(obj, key, where);
  if (err) return err;
  const value = obj[key] as number;
  if (!Number.isInteger(value) || value < min) {
    return fail(`${where}.${key}: expected integer >= ${min}`);
  }
  return null;
}

function requireBoolean(obj: Record<string, unknown>, key: string, where: string): string | null {
  if (typeof obj[key] !== "boolean") {
    return fail(`${where}.${key}: expected boolean`);
  }
  return null;
}

function requirePlainObject(obj: Record<string, unknown>, key: string, where: string): string | null {
  if (!isPlainObject(obj[key])) {
    return fail(`${where}.${key}: expected object`);
  }
  if (Object.keys(obj[key] as object).length > MAX_OBJECT_KEYS) {
    return fail(`${where}.${key}: too many keys`);
  }
  return null;
}

function requireArray(obj: Record<string, unknown>, key: string, where: string): string | null {
  if (!Array.isArray(obj[key])) {
    return fail(`${where}.${key}: expected array`);
  }
  if ((obj[key] as unknown[]).length > MAX_ARRAY_LENGTH) {
    return fail(`${where}.${key}: array exceeds ${MAX_ARRAY_LENGTH}`);
  }
  return null;
}

function firstError(...errors: Array<string | null>): string | null {
  for (const error of errors) {
    if (error) return error;
  }
  return null;
}

function requireEnum(obj: Record<string, unknown>, key: string, where: string, values: readonly string[]): string | null {
  const err = requireString(obj, key, where);
  if (err) return err;
  if (!values.includes(obj[key] as string)) {
    return fail(`${where}.${key}: expected one of ${values.join("|")}`);
  }
  return null;
}

function validateScoreState(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireFiniteNumber(raw, "total", where),
    requireFiniteNumber(raw, "finalPopulationRisk", where),
    requireFiniteNumber(raw, "infrastructureAvailability", where),
    requireFiniteNumber(raw, "eventsHandledPoints", where),
    requireFiniteNumber(raw, "eventsMissedPoints", where),
    requireFiniteNumber(raw, "misadvisoryCost", where),
    requireFiniteNumber(raw, "wastedDispatchCost", where),
    requireFiniteNumber(raw, "decisionDelayPoints", where),
    requireFiniteNumber(raw, "resourceEfficiency", where),
    requireFiniteNumber(raw, "chainFailurePenalty", where),
    requirePlainObject(raw, "raw", where),
    requireArray(raw, "breakdown", where),
  );
}

function validateDistrictState(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "id", where),
    requireFiniteNumber(raw, "power", where),
    requireFiniteNumber(raw, "communications", where),
    requireFiniteNumber(raw, "water", where),
    requireFiniteNumber(raw, "traffic", where),
    requireFiniteNumber(raw, "medicalCapacity", where),
    requireFiniteNumber(raw, "hazardLevel", where),
    requireFiniteNumber(raw, "populationRisk", where),
  );
}

function validateOwnTeam(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "teamId", where),
    requireNonEmptyString(raw, "type", where),
    requireNonEmptyString(raw, "location", where),
    requireNonEmptyString(raw, "status", where),
    raw["etaTick"] !== null && (typeof raw["etaTick"] !== "number" || !Number.isInteger(raw["etaTick"] as number))
      ? `${where}.etaTick: expected integer|null`
      : null,
    raw["orderTarget"] !== null && typeof raw["orderTarget"] !== "string" ? `${where}.orderTarget: expected string|null` : null,
    raw["orderTask"] !== null && typeof raw["orderTask"] !== "string" ? `${where}.orderTask: expected string|null` : null,
  );
}

function validateKnownRoute(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "id", where),
    requireBoolean(raw, "closed", where),
    raw["knownClosedAtTick"] !== null &&
      (typeof raw["knownClosedAtTick"] !== "number" || !Number.isInteger(raw["knownClosedAtTick"] as number))
      ? `${where}.knownClosedAtTick: expected integer|null`
      : null,
  );
}

function validateEvidence(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "id", where),
    requireNonEmptyString(raw, "claimId", where),
    requireNonEmptyString(raw, "sourceId", where),
    requireInt(raw, "observedTick", where, 0),
    requireInt(raw, "deliveredTick", where, 0),
    requireString(raw, "content", where),
    requireNonEmptyString(raw, "category", where),
    requireFiniteNumber(raw, "reliability", where),
    requireBoolean(raw, "verified", where),
  );
}

function validateClaim(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "id", where),
    requireString(raw, "subject", where),
    requireString(raw, "predicate", where),
    requireInt(raw, "firstObservedTick", where, 0),
    requireInt(raw, "lastUpdatedTick", where, 0),
    requireEnum(raw, "status", where, ["reported", "corroborated", "contested", "verified", "refuted", "stale"]),
    requireArray(raw, "evidenceIds", where),
    requireInt(raw, "asOfTick", where, 0),
  );
}

function validateAssessment(raw: unknown, where: string): string | null {
  if (!isPlainObject(raw)) return fail(`${where}: expected object`);
  return firstError(
    requireNonEmptyString(raw, "id", where),
    requireNonEmptyString(raw, "claimId", where),
    requireFiniteNumber(raw, "probability", where),
    requireFiniteNumber(raw, "confidence", where),
    requireInt(raw, "submittedTick", where, 0),
  );
}

const TRUTH_KIND_VALIDATORS: Record<string, (payload: Record<string, unknown>) => string | null> = {
  ScenarioStarted: (p) =>
    firstError(
      requireNonEmptyString(p, "scenarioId", "ScenarioStarted"),
      requireInt(p, "seed", "ScenarioStarted", Number.MIN_SAFE_INTEGER),
      requireFiniteNumber(p, "tickPerSimSecond", "ScenarioStarted"),
      requireInt(p, "totalTicks", "ScenarioStarted", 1),
      requireArray(p, "districts", "ScenarioStarted"),
    ),
  TrueIncidentOccurred: (p) =>
    firstError(
      requireNonEmptyString(p, "incidentId", "TrueIncidentOccurred"),
      requireNonEmptyString(p, "kind", "TrueIncidentOccurred"),
      requireNonEmptyString(p, "district", "TrueIncidentOccurred"),
      requireFiniteNumber(p, "severity", "TrueIncidentOccurred"),
    ),
  IncidentChained: (p) =>
    firstError(
      requireNonEmptyString(p, "incidentId", "IncidentChained"),
      requireNonEmptyString(p, "sourceIncidentId", "IncidentChained"),
      requireNonEmptyString(p, "district", "IncidentChained"),
      requireFiniteNumber(p, "severity", "IncidentChained"),
    ),
  IncidentResolved: (p) =>
    firstError(
      requireNonEmptyString(p, "incidentId", "IncidentResolved"),
      requireNonEmptyString(p, "district", "IncidentResolved"),
      requireInt(p, "handledTick", "IncidentResolved", 0),
    ),
  ObservationCreated: (p) =>
    firstError(
      requireNonEmptyString(p, "observationId", "ObservationCreated"),
      requireNonEmptyString(p, "incidentId", "ObservationCreated"),
      requireNonEmptyString(p, "source", "ObservationCreated"),
      requireInt(p, "observedTick", "ObservationCreated", 0),
      requireString(p, "content", "ObservationCreated"),
      requireFiniteNumber(p, "reliability", "ObservationCreated"),
      requireNonEmptyString(p, "category", "ObservationCreated"),
    ),
  ObservationDelayed: (p) =>
    firstError(
      requireNonEmptyString(p, "observationId", "ObservationDelayed"),
      requireInt(p, "newDeliveryTick", "ObservationDelayed", 0),
      requireInt(p, "delayTicks", "ObservationDelayed", Number.MIN_SAFE_INTEGER),
    ),
  ObservationCorrupted: (p) =>
    firstError(
      requireNonEmptyString(p, "observationId", "ObservationCorrupted"),
      requireNonEmptyString(p, "corruptionType", "ObservationCorrupted"),
      requireString(p, "original", "ObservationCorrupted"),
      requireString(p, "corrupted", "ObservationCorrupted"),
      requireBoolean(p, "false", "ObservationCorrupted"),
    ),
  ObservationLost: (p) =>
    firstError(requireNonEmptyString(p, "observationId", "ObservationLost"), requireNonEmptyString(p, "reason", "ObservationLost")),
  ObservationDelivered: (p) =>
    firstError(requireNonEmptyString(p, "observationId", "ObservationDelivered"), requireInt(p, "deliveredTick", "ObservationDelivered", 0)),
  CommandIssued: (p) =>
    firstError(
      requireNonEmptyString(p, "commandId", "CommandIssued"),
      requireNonEmptyString(p, "commandName", "CommandIssued"),
      requireNonEmptyString(p, "idempotencyKey", "CommandIssued"),
      requireInt(p, "issuedTick", "CommandIssued", 0),
      p["target"] !== null && typeof p["target"] !== "string" ? "CommandIssued.target: expected string|null" : null,
      requirePlainObject(p, "params", "CommandIssued"),
    ),
  CommandRejected: (p) =>
    firstError(
      requireNonEmptyString(p, "commandId", "CommandRejected"),
      requireString(p, "reason", "CommandRejected"),
      requireNonEmptyString(p, "code", "CommandRejected"),
    ),
  CommandAccepted: (p) =>
    firstError(
      requireNonEmptyString(p, "commandId", "CommandAccepted"),
      requireNonEmptyString(p, "idempotencyKey", "CommandAccepted"),
      p["etaTick"] !== null && (typeof p["etaTick"] !== "number" || !Number.isInteger(p["etaTick"] as number))
        ? "CommandAccepted.etaTick: expected integer|null"
        : null,
    ),
  TeamDispatched: (p) =>
    firstError(
      requireNonEmptyString(p, "teamId", "TeamDispatched"),
      requireNonEmptyString(p, "orderId", "TeamDispatched"),
      requireNonEmptyString(p, "from", "TeamDispatched"),
      requireNonEmptyString(p, "to", "TeamDispatched"),
      requireInt(p, "travelTicks", "TeamDispatched", 0),
      requireInt(p, "etaTick", "TeamDispatched", 0),
    ),
  TeamArrived: (p) =>
    firstError(
      requireNonEmptyString(p, "teamId", "TeamArrived"),
      requireString(p, "orderId", "TeamArrived"),
      requireNonEmptyString(p, "district", "TeamArrived"),
    ),
  ActionApplied: (p) =>
    firstError(
      requireNonEmptyString(p, "action", "ActionApplied"),
      requireNonEmptyString(p, "target", "ActionApplied"),
      requireNonEmptyString(p, "attribute", "ActionApplied"),
      requireFiniteNumber(p, "delta", "ActionApplied"),
      requireFiniteNumber(p, "result", "ActionApplied"),
    ),
  SystemStateChanged: (p) => {
    const base = firstError(
      requirePlainObject(p, "districts", "SystemStateChanged"),
      requireArray(p, "teams", "SystemStateChanged"),
      requirePlainObject(p, "routes", "SystemStateChanged"),
      requirePlainObject(p, "resources", "SystemStateChanged"),
    );
    if (base) return base;
    for (const [id, district] of Object.entries(p["districts"] as Record<string, unknown>)) {
      const err = validateDistrictState(district, `SystemStateChanged.districts.${id}`);
      if (err) return err;
    }
    const resources = p["resources"] as Record<string, unknown>;
    return firstError(
      requireInt(resources, "backupGenerators", "SystemStateChanged.resources", 0),
      requireInt(resources, "advisoryUses", "SystemStateChanged.resources", 0),
    );
  },
  ScoreChanged: (p) =>
    firstError(
      requireFiniteNumber(p, "delta", "ScoreChanged"),
      requireString(p, "reason", "ScoreChanged"),
      requireNonEmptyString(p, "category", "ScoreChanged"),
      requireFiniteNumber(p, "total", "ScoreChanged"),
    ),
  ScenarioCompleted: (p) => {
    const scoreErr = validateScoreState(p["finalScore"], "ScenarioCompleted.finalScore");
    if (scoreErr) return scoreErr;
    return requireInt(p, "finalTick", "ScenarioCompleted", 0);
  },
};

const PLAYER_KIND_VALIDATORS: Record<string, (payload: Record<string, unknown>) => string | null> = {
  SessionStarted: (p) => {
    const base = firstError(
      requireNonEmptyString(p, "scenarioId", "SessionStarted"),
      requireInt(p, "seed", "SessionStarted", Number.MIN_SAFE_INTEGER),
      requireInt(p, "totalTicks", "SessionStarted", 1),
      requireArray(p, "teams", "SessionStarted"),
      requireArray(p, "routes", "SessionStarted"),
      requirePlainObject(p, "resources", "SessionStarted"),
    );
    if (base) return base;
    for (const [i, team] of (p["teams"] as unknown[]).entries()) {
      const err = validateOwnTeam(team, `SessionStarted.teams[${i}]`);
      if (err) return err;
    }
    for (const [i, route] of (p["routes"] as unknown[]).entries()) {
      const err = validateKnownRoute(route, `SessionStarted.routes[${i}]`);
      if (err) return err;
    }
    const resources = p["resources"] as Record<string, unknown>;
    return firstError(
      requireInt(resources, "backupGenerators", "SessionStarted.resources", 0),
      requireInt(resources, "advisoryUses", "SessionStarted.resources", 0),
    );
  },
  EvidenceRecorded: (p) => {
    const err = requirePlainObject(p, "evidence", "EvidenceRecorded");
    if (err) return err;
    return validateEvidence(p["evidence"], "EvidenceRecorded.evidence");
  },
  ClaimUpdated: (p) => {
    const base = firstError(
      requirePlainObject(p, "claim", "ClaimUpdated"),
      requireEnum(p, "reason", "ClaimUpdated", [
        "reported",
        "corroborated",
        "contested",
        "verified",
        "refuted",
        "stale",
        "updated",
      ]),
    );
    if (base) return base;
    return validateClaim(p["claim"], "ClaimUpdated.claim");
  },
  AssessmentSubmitted: (p) => {
    const err = requirePlainObject(p, "assessment", "AssessmentSubmitted");
    if (err) return err;
    return validateAssessment(p["assessment"], "AssessmentSubmitted.assessment");
  },
  VerificationResolved: (p) =>
    firstError(
      requireNonEmptyString(p, "claimId", "VerificationResolved"),
      requireNonEmptyString(p, "teamId", "VerificationResolved"),
      requireEnum(p, "outcome", "VerificationResolved", ["verified", "refuted", "inconclusive"]),
      requireInt(p, "resolvedTick", "VerificationResolved", 0),
    ),
  CommandResult: (p) =>
    firstError(
      requireNonEmptyString(p, "commandId", "CommandResult"),
      requireNonEmptyString(p, "commandName", "CommandResult"),
      requireNonEmptyString(p, "idempotencyKey", "CommandResult"),
      requireEnum(p, "state", "CommandResult", ["accepted", "rejected"]),
      p["errorCode"] !== null && typeof p["errorCode"] !== "string" ? "CommandResult.errorCode: expected string|null" : null,
      p["detail"] !== null && typeof p["detail"] !== "string" ? "CommandResult.detail: expected string|null" : null,
      p["etaTick"] !== null && (typeof p["etaTick"] !== "number" || !Number.isInteger(p["etaTick"] as number))
        ? "CommandResult.etaTick: expected integer|null"
        : null,
      requireString(p, "target", "CommandResult"),
    ),
  OwnTeamUpdated: (p) => {
    const err = requirePlainObject(p, "team", "OwnTeamUpdated");
    if (err) return err;
    return validateOwnTeam(p["team"], "OwnTeamUpdated.team");
  },
  KnownRouteUpdated: (p) => {
    const err = requirePlainObject(p, "route", "KnownRouteUpdated");
    if (err) return err;
    return validateKnownRoute(p["route"], "KnownRouteUpdated.route");
  },
  PublicScoreChanged: (p) =>
    firstError(
      requireFiniteNumber(p, "delta", "PublicScoreChanged"),
      requireString(p, "reason", "PublicScoreChanged"),
      requireNonEmptyString(p, "category", "PublicScoreChanged"),
      requireFiniteNumber(p, "total", "PublicScoreChanged"),
    ),
  ResourcesChanged: (p) => {
    const err = requirePlainObject(p, "resources", "ResourcesChanged");
    if (err) return err;
    const resources = p["resources"] as Record<string, unknown>;
    return firstError(
      requireInt(resources, "backupGenerators", "ResourcesChanged.resources", 0),
      requireInt(resources, "advisoryUses", "ResourcesChanged.resources", 0),
    );
  },
  RunCompleted: (p) =>
    firstError(
      requireInt(p, "finalTick", "RunCompleted", 0),
      requireFiniteNumber(p, "scoreTotal", "RunCompleted"),
      requireInt(p, "claimCount", "RunCompleted", 0),
      requireInt(p, "evidenceCount", "RunCompleted", 0),
    ),
};

export function validateReplayTruthPayload(kind: string, payload: unknown): string | null {
  const validator = TRUTH_KIND_VALIDATORS[kind];
  if (!validator) {
    return `unknown_kind:${kind}`;
  }
  if (!isPlainObject(payload)) {
    return `invalid_payload:${kind}:expected a non-array object`;
  }
  if (Object.keys(payload).length > MAX_OBJECT_KEYS) {
    return `invalid_payload:${kind}:too many keys`;
  }
  return validator(payload);
}

export function validateReplayPlayerPayload(kind: string, payload: unknown): string | null {
  const validator = PLAYER_KIND_VALIDATORS[kind];
  if (!validator) {
    return `unknown_kind:${kind}`;
  }
  if (!isPlainObject(payload)) {
    return `invalid_payload:${kind}:expected a non-array object`;
  }
  if (Object.keys(payload).length > MAX_OBJECT_KEYS) {
    return `invalid_payload:${kind}:too many keys`;
  }
  return validator(payload);
}

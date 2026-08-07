/**
 * Clean-room run artifact schema for Replay Lab.
 *
 * Deliberately does NOT import `@null-city/simulation` (forbidden for
 * player-facing code) or any truth-only symbol from `@null-city/contracts`
 * (`EventEnvelope`, `EventKindName`, truth payload types — see
 * `test/forbidden-imports.test.ts`). `ReplayTruthEvent` below is a local,
 * duck-typed structural mirror of the server's truth event envelope: it
 * lets Replay Lab render truth *after* a run has completed (the sanctioned
 * epistemic-boundary exception) without the browser bundle ever importing
 * a truth type or truth-aware code path.
 *
 * `PlayerEventEnvelope` and its payload/value types ARE permitted (they are
 * the same public contract the live Command Center already renders), so
 * those are imported as types only — erased at build, never a runtime
 * dependency.
 */
import type {
  Assessment,
  AssessmentSubmittedPayload,
  Claim,
  ClaimUpdatedPayload,
  Evidence,
  EvidenceRecordedPayload,
  KnownRouteState,
  KnownRouteUpdatedPayload,
  OwnTeamState,
  OwnTeamUpdatedPayload,
  PlayerEventEnvelope,
  PublicResources,
  PublicScoreChangedPayload,
  ResourcesChangedPayload,
  RunCompletedPayload,
  SessionStartedPayload,
} from "@null-city/contracts";

export const RUN_ARTIFACT_FORMAT = "null-city-run-artifact";
export const RUN_ARTIFACT_VERSION = 2;

/** Matches `packages/simulation/src/artifact.ts`'s `MAX_ARTIFACT_BYTES`. */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export type ReplayTruthEventKind =
  | "ScenarioStarted"
  | "TrueIncidentOccurred"
  | "IncidentChained"
  | "IncidentResolved"
  | "ObservationCreated"
  | "ObservationDelayed"
  | "ObservationCorrupted"
  | "ObservationLost"
  | "ObservationDelivered"
  | "CommandIssued"
  | "CommandRejected"
  | "CommandAccepted"
  | "TeamDispatched"
  | "TeamArrived"
  | "ActionApplied"
  | "SystemStateChanged"
  | "ScoreChanged"
  | "ScenarioCompleted";

/** Structural mirror of the truth event envelope; not a truth-type import. */
export interface ReplayTruthEvent {
  sessionId: string;
  sequence: number;
  tick: number;
  kind: ReplayTruthEventKind;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface ReplayCommandTraceEntry {
  sequence: number;
  commandId: string;
  commandName: string;
  idempotencyKey: string;
  issuedTick: number;
  target: string | null;
  params: Record<string, unknown>;
  outcome: "accepted" | "rejected";
  errorCode: string | null;
  errorMessage: string | null;
  etaTick: number | null;
}

export interface ReplayAssessmentTraceEntry {
  id: string;
  claimId: string;
  probability: number;
  confidence: number;
  rationale?: string;
  submittedTick: number;
}

export interface ReplayIdentity {
  sessionId: string;
  scenarioId: string;
  scenarioDigest: string;
  engineProtocolVersion: number;
  seed: number;
  totalTicks: number;
}

export interface ReplaySignature {
  algorithm: string;
  keyId: string;
  signature: string;
}

export interface ReplayArtifact {
  format: string;
  version: number;
  identity: ReplayIdentity;
  finalTick: number;
  eventCount: number;
  playerEventCount: number;
  truthLogHash: string;
  playerLogHash: string;
  stateDigest: string;
  scoreDigest: string;
  scoreTotal: number;
  handledIncidents: string[];
  activeIncidents: string[];
  commandTrace: ReplayCommandTraceEntry[];
  assessmentTrace: ReplayAssessmentTraceEntry[];
  /** Opaque public-action ledger (artifact v2); required for hash fidelity. */
  publicActionLedger: unknown[];
  truth: { events: ReplayTruthEvent[] };
  player: { events: PlayerEventEnvelope[] };
  signature: ReplaySignature | null;
  artifactHash: string;
}

export type { SessionStartedPayload };

export type ReplayPlayerPayload =
  | SessionStartedPayload
  | EvidenceRecordedPayload
  | ClaimUpdatedPayload
  | AssessmentSubmittedPayload
  | OwnTeamUpdatedPayload
  | KnownRouteUpdatedPayload
  | PublicScoreChangedPayload
  | ResourcesChangedPayload
  | RunCompletedPayload;

export type { Assessment, Claim, Evidence, KnownRouteState, OwnTeamState, PublicResources };

export class ReplayArtifactParseError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new ReplayArtifactParseError(`${where}.${key} must be a string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReplayArtifactParseError(`${where}.${key} must be a finite number`);
  }
  return value;
}

function requireArray(obj: Record<string, unknown>, key: string, where: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new ReplayArtifactParseError(`${where}.${key} must be an array`);
  }
  return value;
}

function validateTruthEvent(raw: unknown, index: number): ReplayTruthEvent {
  const where = `truth.events[${index}]`;
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object`);
  }
  const sessionId = requireString(raw, "sessionId", where);
  const sequence = requireNumber(raw, "sequence", where);
  const tick = requireNumber(raw, "tick", where);
  const kind = requireString(raw, "kind", where);
  const previousHash = requireString(raw, "previousHash", where);
  const hash = requireString(raw, "hash", where);
  const payload = raw["payload"];
  if (!isPlainObject(payload)) {
    throw new ReplayArtifactParseError(`${where}.payload must be an object`);
  }
  return {
    sessionId,
    sequence,
    tick,
    kind: kind as ReplayTruthEventKind,
    payload,
    previousHash,
    hash,
  };
}

function validatePlayerEvent(raw: unknown, index: number): PlayerEventEnvelope {
  const where = `player.events[${index}]`;
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object`);
  }
  if (raw["stream"] !== "player") {
    throw new ReplayArtifactParseError(`${where}.stream must be "player"`);
  }
  requireString(raw, "sessionId", where);
  requireNumber(raw, "sequence", where);
  requireNumber(raw, "tick", where);
  requireString(raw, "kind", where);
  requireString(raw, "previousHash", where);
  requireString(raw, "hash", where);
  if (raw["payload"] === null || typeof raw["payload"] !== "object") {
    throw new ReplayArtifactParseError(`${where}.payload must be an object`);
  }
  return raw as unknown as PlayerEventEnvelope;
}

function validateCommandTraceEntry(raw: unknown, index: number): ReplayCommandTraceEntry {
  const where = `commandTrace[${index}]`;
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object`);
  }
  const outcome = requireString(raw, "outcome", where);
  if (outcome !== "accepted" && outcome !== "rejected") {
    throw new ReplayArtifactParseError(`${where}.outcome must be "accepted" or "rejected"`);
  }
  const params = raw["params"];
  if (!isPlainObject(params)) {
    throw new ReplayArtifactParseError(`${where}.params must be an object`);
  }
  return {
    sequence: requireNumber(raw, "sequence", where),
    commandId: requireString(raw, "commandId", where),
    commandName: requireString(raw, "commandName", where),
    idempotencyKey: requireString(raw, "idempotencyKey", where),
    issuedTick: requireNumber(raw, "issuedTick", where),
    target: (raw["target"] as string | null) ?? null,
    params,
    outcome,
    errorCode: (raw["errorCode"] as string | null) ?? null,
    errorMessage: (raw["errorMessage"] as string | null) ?? null,
    etaTick: typeof raw["etaTick"] === "number" ? raw["etaTick"] : null,
  };
}

function validateAssessmentTraceEntry(raw: unknown, index: number): ReplayAssessmentTraceEntry {
  const where = `assessmentTrace[${index}]`;
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object`);
  }
  const entry: ReplayAssessmentTraceEntry = {
    id: requireString(raw, "id", where),
    claimId: requireString(raw, "claimId", where),
    probability: requireNumber(raw, "probability", where),
    confidence: requireNumber(raw, "confidence", where),
    submittedTick: requireNumber(raw, "submittedTick", where),
  };
  if (typeof raw["rationale"] === "string") {
    entry.rationale = raw["rationale"];
  }
  return entry;
}

function validateIdentity(raw: unknown): ReplayIdentity {
  const where = "identity";
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object`);
  }
  return {
    sessionId: requireString(raw, "sessionId", where),
    scenarioId: requireString(raw, "scenarioId", where),
    scenarioDigest: requireString(raw, "scenarioDigest", where),
    engineProtocolVersion: requireNumber(raw, "engineProtocolVersion", where),
    seed: requireNumber(raw, "seed", where),
    totalTicks: requireNumber(raw, "totalTicks", where),
  };
}

function validateSignature(raw: unknown): ReplaySignature | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const where = "signature";
  if (!isPlainObject(raw)) {
    throw new ReplayArtifactParseError(`${where} must be an object or null`);
  }
  return {
    algorithm: requireString(raw, "algorithm", where),
    keyId: requireString(raw, "keyId", where),
    signature: requireString(raw, "signature", where),
  };
}

/**
 * Unwraps the REST transport's `{ ok, result }` envelope (see
 * `apps/command-center/src/api/rest.ts`) into the bare artifact JSON text
 * that `parseReplayArtifact` expects, applying the same bounded-size check
 * (with a small fixed allowance for envelope overhead) before touching
 * `JSON.parse`. Kept separate from `parseReplayArtifact` so file-drop input
 * (never enveloped) and server-fetched input share the same downstream
 * structural validator.
 */
export function unwrapArtifactEnvelope(raw: string, maxBytes: number = MAX_ARTIFACT_BYTES): string {
  if (typeof raw !== "string") {
    throw new ReplayArtifactParseError("server response must be a string");
  }
  const byteLength = new TextEncoder().encode(raw).length;
  const envelopeOverheadAllowance = 4096;
  if (byteLength > maxBytes + envelopeOverheadAllowance) {
    throw new ReplayArtifactParseError(
      `server response exceeds maximum accepted size of ${maxBytes} bytes (got ${byteLength})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReplayArtifactParseError("server response is not valid JSON");
  }
  if (!isPlainObject(parsed) || parsed["ok"] !== true || !isPlainObject(parsed["result"])) {
    throw new ReplayArtifactParseError("server response is not a valid artifact envelope");
  }
  return JSON.stringify(parsed["result"]);
}

/**
 * Strict runtime parser with a bounded input size. Rejects malformed JSON,
 * wrong-shape objects, and oversized payloads before they ever reach
 * `JSON.parse` semantics that matter (the byte-length check runs first).
 */
export function parseReplayArtifact(raw: string, maxBytes: number = MAX_ARTIFACT_BYTES): ReplayArtifact {
  if (typeof raw !== "string") {
    throw new ReplayArtifactParseError("artifact input must be a string");
  }
  const byteLength = new TextEncoder().encode(raw).length;
  if (byteLength > maxBytes) {
    throw new ReplayArtifactParseError(
      `artifact exceeds maximum accepted size of ${maxBytes} bytes (got ${byteLength})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReplayArtifactParseError("artifact is not valid JSON");
  }

  if (!isPlainObject(parsed)) {
    throw new ReplayArtifactParseError("artifact root must be an object");
  }
  if (parsed["format"] !== RUN_ARTIFACT_FORMAT) {
    throw new ReplayArtifactParseError(`unknown artifact format ${JSON.stringify(parsed["format"])}`);
  }
  if (parsed["version"] !== RUN_ARTIFACT_VERSION) {
    throw new ReplayArtifactParseError(`unsupported artifact version ${JSON.stringify(parsed["version"])}`);
  }

  const identity = validateIdentity(parsed["identity"]);

  const truthContainer = parsed["truth"];
  if (!isPlainObject(truthContainer)) {
    throw new ReplayArtifactParseError("artifact missing truth object");
  }
  const truthEventsRaw = requireArray(truthContainer, "events", "truth");
  const truthEvents = truthEventsRaw.map((event, index) => validateTruthEvent(event, index));

  const playerContainer = parsed["player"];
  if (!isPlainObject(playerContainer)) {
    throw new ReplayArtifactParseError("artifact missing player object");
  }
  const playerEventsRaw = requireArray(playerContainer, "events", "player");
  const playerEvents = playerEventsRaw.map((event, index) => validatePlayerEvent(event, index));

  const commandTraceRaw = requireArray(parsed, "commandTrace", "artifact");
  const commandTrace = commandTraceRaw.map((entry, index) => validateCommandTraceEntry(entry, index));

  const assessmentTraceRaw = requireArray(parsed, "assessmentTrace", "artifact");
  const assessmentTrace = assessmentTraceRaw.map((entry, index) => validateAssessmentTraceEntry(entry, index));

  const publicActionLedger = requireArray(parsed, "publicActionLedger", "artifact");

  const handledIncidentsRaw = requireArray(parsed, "handledIncidents", "artifact");
  const activeIncidentsRaw = requireArray(parsed, "activeIncidents", "artifact");
  if (!handledIncidentsRaw.every((v) => typeof v === "string") || !activeIncidentsRaw.every((v) => typeof v === "string")) {
    throw new ReplayArtifactParseError("handledIncidents/activeIncidents must be string arrays");
  }

  return {
    format: RUN_ARTIFACT_FORMAT,
    version: RUN_ARTIFACT_VERSION,
    identity,
    finalTick: requireNumber(parsed, "finalTick", "artifact"),
    eventCount: requireNumber(parsed, "eventCount", "artifact"),
    playerEventCount: requireNumber(parsed, "playerEventCount", "artifact"),
    truthLogHash: requireString(parsed, "truthLogHash", "artifact"),
    playerLogHash: requireString(parsed, "playerLogHash", "artifact"),
    stateDigest: requireString(parsed, "stateDigest", "artifact"),
    scoreDigest: requireString(parsed, "scoreDigest", "artifact"),
    scoreTotal: requireNumber(parsed, "scoreTotal", "artifact"),
    handledIncidents: handledIncidentsRaw as string[],
    activeIncidents: activeIncidentsRaw as string[],
    commandTrace,
    assessmentTrace,
    publicActionLedger,
    truth: { events: truthEvents },
    player: { events: playerEvents },
    signature: validateSignature(parsed["signature"]),
    artifactHash: requireString(parsed, "artifactHash", "artifact"),
  };
}

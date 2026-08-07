import { createHash } from "node:crypto";

import type { EventEnvelope, EventKindName } from "./events.js";
import { validatePlayerEventPayload } from "./player-payloads.js";
import type { PlayerEventEnvelope, PlayerEventKind } from "./public.js";
import { validateTruthEventPayload } from "./truth-payloads.js";

/**
 * Canonical serialization.
 *
 * JavaScript objects do not guarantee key order. We therefore sort object
 * keys recursively before hashing so that two equal logical events always
 * produce equal hashes regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortDeep(record[key]);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function eventHash(envelopeWithoutHash: Omit<EventEnvelope, "hash">): string {
  return sha256(
    canonicalJson({
      sessionId: envelopeWithoutHash.sessionId,
      sequence: envelopeWithoutHash.sequence,
      tick: envelopeWithoutHash.tick,
      kind: envelopeWithoutHash.kind,
      payload: envelopeWithoutHash.payload,
      previousHash: envelopeWithoutHash.previousHash,
    }),
  );
}

export function playerEventHash(envelopeWithoutHash: Omit<PlayerEventEnvelope, "hash">): string {
  return sha256(
    canonicalJson({
      stream: "player",
      sessionId: envelopeWithoutHash.sessionId,
      sequence: envelopeWithoutHash.sequence,
      tick: envelopeWithoutHash.tick,
      kind: envelopeWithoutHash.kind,
      payload: envelopeWithoutHash.payload,
      previousHash: envelopeWithoutHash.previousHash,
    }),
  );
}

const PLAYER_EVENT_KINDS = new Set<PlayerEventKind>([
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

export function verifyPlayerEventStream(
  events: PlayerEventEnvelope[],
  options: VerifyEventStreamOptions = {},
): EventHashResult {
  if (events.length === 0) {
    if (options.requireNonEmpty) {
      return { hash: "", validChain: false, brokenAt: 0, reason: "empty_stream" };
    }
    return { hash: "", validChain: true, brokenAt: null };
  }
  const genesisPrevious = options.expectedGenesisPreviousHash ?? GENESIS_PREVIOUS_HASH;
  let previousHash = genesisPrevious;
  let previousTick = Number.NEGATIVE_INFINITY;
  let expectedSequence = 0;
  const sessionId = options.expectedSessionId ?? events[0]!.sessionId;

  for (const event of events) {
    if (event.stream !== "player") {
      return failAt(event as unknown as EventEnvelope, "invalid_stream");
    }
    if (event.sessionId !== sessionId) {
      return failAt(event as unknown as EventEnvelope, "session_mismatch");
    }
    if (event.sequence !== expectedSequence) {
      return failAt(event as unknown as EventEnvelope, "sequence_gap");
    }
    if (!Number.isInteger(event.tick) || event.tick < 0) {
      return failAt(event as unknown as EventEnvelope, "invalid_tick");
    }
    if (event.tick < previousTick) {
      return failAt(event as unknown as EventEnvelope, "tick_rollback");
    }
    if (!PLAYER_EVENT_KINDS.has(event.kind)) {
      return failAt(event as unknown as EventEnvelope, "unknown_kind");
    }
    const payloadReason = validatePlayerEventPayload(event.kind, event.payload);
    if (payloadReason !== null) {
      return failAt(event as unknown as EventEnvelope, payloadReason);
    }
    if (event.previousHash !== previousHash) {
      return failAt(event as unknown as EventEnvelope, "previous_hash_mismatch");
    }
    const expected = playerEventHash({
      stream: "player",
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash,
    });
    if (event.hash !== expected) {
      return failAt(event as unknown as EventEnvelope, "hash_mismatch");
    }
    previousHash = event.hash;
    previousTick = event.tick;
    expectedSequence += 1;
  }
  if (options.expectedTerminalHash !== undefined && previousHash !== options.expectedTerminalHash) {
    return {
      hash: previousHash,
      validChain: false,
      brokenAt: events[events.length - 1]!.sequence,
      reason: "terminal_hash_mismatch",
    };
  }
  return { hash: previousHash, validChain: true, brokenAt: null };
}

export interface EventHashResult {
  hash: string;
  validChain: boolean;
  /** first sequence number where the chain is broken; null when valid */
  brokenAt: number | null;
  /** machine-readable failure reason when invalid */
  reason?: string;
}

const EVENT_KINDS = new Set<EventKindName>([
  "ScenarioStarted",
  "TrueIncidentOccurred",
  "IncidentChained",
  "IncidentResolved",
  "ObservationCreated",
  "ObservationDelayed",
  "ObservationCorrupted",
  "ObservationLost",
  "ObservationDelivered",
  "CommandIssued",
  "CommandRejected",
  "CommandAccepted",
  "TeamDispatched",
  "TeamArrived",
  "ActionApplied",
  "SystemStateChanged",
  "ScoreChanged",
  "ScenarioCompleted",
]);

/** Empty previousHash marks the genesis event of a truth/player stream. */
export const GENESIS_PREVIOUS_HASH = "";

export interface VerifyEventStreamOptions {
  /** When set, every event must carry this session id. */
  expectedSessionId?: string;
  /** When set, the final event hash must equal this value. */
  expectedTerminalHash?: string;
  /** Reject empty streams when true. Default false (empty is trivially valid). */
  requireNonEmpty?: boolean;
  /** Allowed genesis previousHash. Default "". */
  expectedGenesisPreviousHash?: string;
}

function failAt(event: EventEnvelope | undefined, reason: string): EventHashResult {
  return {
    hash: event?.hash ?? "",
    validChain: false,
    brokenAt: event?.sequence ?? 0,
    reason,
  };
}

/**
 * Full stream verification: genesis, session, sequence contiguity, monotonic
 * tick, kind allow-list, payload shape, hash links, and optional terminal root.
 *
 * A valid hash chain alone is only tamper-evident. Authenticity requires a
 * trusted external root (expectedTerminalHash) or signature outside this API.
 */
export function verifyEventStream(
  events: EventEnvelope[],
  options: VerifyEventStreamOptions = {},
): EventHashResult {
  if (events.length === 0) {
    if (options.requireNonEmpty) {
      return { hash: "", validChain: false, brokenAt: 0, reason: "empty_stream" };
    }
    return { hash: "", validChain: true, brokenAt: null };
  }

  const genesisPrevious = options.expectedGenesisPreviousHash ?? GENESIS_PREVIOUS_HASH;
  let previousHash = genesisPrevious;
  let previousTick = Number.NEGATIVE_INFINITY;
  let expectedSequence = 0;
  const sessionId = options.expectedSessionId ?? events[0]!.sessionId;

  for (const event of events) {
    if (typeof event.sessionId !== "string" || event.sessionId.length === 0) {
      return failAt(event, "invalid_session");
    }
    if (event.sessionId !== sessionId) {
      return failAt(event, "session_mismatch");
    }
    if (options.expectedSessionId !== undefined && event.sessionId !== options.expectedSessionId) {
      return failAt(event, "session_mismatch");
    }
    if (!Number.isInteger(event.sequence) || event.sequence !== expectedSequence) {
      return failAt(event, "sequence_gap");
    }
    if (!Number.isInteger(event.tick) || event.tick < 0) {
      return failAt(event, "invalid_tick");
    }
    if (event.tick < previousTick) {
      return failAt(event, "tick_rollback");
    }
    if (typeof event.kind !== "string" || !EVENT_KINDS.has(event.kind as EventKindName)) {
      return failAt(event, "unknown_kind");
    }
    const payloadReason = validateTruthEventPayload(event.kind, event.payload);
    if (payloadReason !== null) {
      return failAt(event, payloadReason);
    }
    if (event.previousHash !== previousHash) {
      return failAt(event, "previous_hash_mismatch");
    }
    if (expectedSequence === 0 && event.previousHash !== genesisPrevious) {
      return failAt(event, "invalid_genesis");
    }

    const expected = eventHash({
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash,
    });
    if (event.hash !== expected) {
      return failAt(event, "hash_mismatch");
    }

    previousHash = event.hash;
    previousTick = event.tick;
    expectedSequence += 1;
  }

  if (options.expectedTerminalHash !== undefined && previousHash !== options.expectedTerminalHash) {
    return {
      hash: previousHash,
      validChain: false,
      brokenAt: events[events.length - 1]!.sequence,
      reason: "terminal_hash_mismatch",
    };
  }

  return { hash: previousHash, validChain: true, brokenAt: null };
}

/**
 * Verifies an ordered event list forms a valid continuous hash chain with
 * stream invariants. Prefer this name in docs; `verifyEventStream` is the
 * explicit API when options are required.
 */
export function verifyEventChain(
  events: EventEnvelope[],
  options?: VerifyEventStreamOptions,
): EventHashResult {
  return verifyEventStream(events, options);
}

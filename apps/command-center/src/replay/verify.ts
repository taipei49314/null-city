/**
 * Browser-side Replay Lab verification (M10.1.1).
 *
 * This is intentionally *not* the same scope as `null-city-run verify`:
 * the browser never loads the compiled scenario or rebuilds the player
 * projection. It may report integrity + semantic bindings only. Named scopes
 * that the browser cannot check are always `NOT_CHECKED`.
 */
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { CanonicalJsonDepthError, canonicalJsonReplay, sha256Hex } from "./hash";
import type { ReplayArtifact, ReplayCommandTraceEntry, ReplayAssessmentTraceEntry, ReplayTruthEvent } from "./schema";

const GENESIS_PREVIOUS_HASH = "";
const SHA256_HEX = /^[0-9a-f]{64}$/;

const ALLOWED_TRUTH_KINDS = new Set<string>([
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

const ALLOWED_PLAYER_KINDS = new Set<string>([
  "SessionStarted",
  "EvidenceRecorded",
  "ClaimUpdated",
  "AssessmentSubmitted",
  "OwnTeamUpdated",
  "KnownRouteUpdated",
  "PublicScoreChanged",
  "ResourcesChanged",
  "CommandResult",
  "VerificationResolved",
  "RunCompleted",
]);

export interface ChainVerifyResult {
  hash: string;
  validChain: boolean;
  brokenAt: number | null;
  reason?: string;
}

export type ReplayVerificationStatus = "FAIL" | "PARTIAL";
export type CheckStatus = "PASS" | "FAIL" | "NOT_CHECKED";

export interface ReplayVerifyScopes {
  integrity: CheckStatus;
  semanticBindings: CheckStatus;
  truthReplay: "NOT_CHECKED";
  playerReplay: "NOT_CHECKED";
  stateDigest: "NOT_CHECKED";
  scenarioContentDigest: "NOT_CHECKED";
  engineProtocolCompatibility: "NOT_CHECKED";
  publicActionLedger: "NOT_CHECKED";
  authenticity: "NOT_CHECKED";
}

export interface ReplayVerifyResult {
  /** Never "PASS full"; browser scope is FAIL or PARTIAL only. */
  status: ReplayVerificationStatus;
  integrityOk: boolean;
  semanticBindingsOk: boolean;
  truthReplayChecked: false;
  playerReplayChecked: false;
  authenticity: "none";
  reasons: string[];
  scopes: ReplayVerifyScopes;
  stateDigestStatus: "NOT_CHECKED";
  scenarioContentDigestStatus: "NOT_CHECKED";
  engineProtocolCompatibilityStatus: "NOT_CHECKED";
  publicActionLedgerStatus: "NOT_CHECKED";
}

function eventHash(event: Pick<ReplayTruthEvent, "sessionId" | "sequence" | "tick" | "kind" | "payload" | "previousHash">): string {
  return sha256Hex(
    canonicalJsonReplay({
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash: event.previousHash,
    }),
  );
}

function playerEventHash(
  event: Pick<PlayerEventEnvelope, "sessionId" | "sequence" | "tick" | "kind" | "payload" | "previousHash">,
): string {
  return sha256Hex(
    canonicalJsonReplay({
      stream: "player",
      sessionId: event.sessionId,
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      payload: event.payload,
      previousHash: event.previousHash,
    }),
  );
}

export function verifyTruthChain(events: readonly ReplayTruthEvent[], expectedTerminalHash?: string): ChainVerifyResult {
  if (events.length === 0) {
    return { hash: "", validChain: false, brokenAt: 0, reason: "empty_stream" };
  }
  let previousHash = GENESIS_PREVIOUS_HASH;
  let previousTick = Number.NEGATIVE_INFINITY;
  let expectedSequence = 0;
  const sessionId = events[0]!.sessionId;

  for (const event of events) {
    if (event.sessionId !== sessionId) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "session_mismatch" };
    }
    if (event.sequence !== expectedSequence) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "sequence_gap" };
    }
    if (!Number.isInteger(event.tick) || event.tick < previousTick) {
      return {
        hash: previousHash,
        validChain: false,
        brokenAt: event.sequence,
        reason: event.tick < previousTick ? "tick_rollback" : "invalid_tick",
      };
    }
    if (event.previousHash !== previousHash) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "previous_hash_mismatch" };
    }
    const expected = eventHash(event);
    if (event.hash !== expected) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "hash_mismatch" };
    }
    previousHash = event.hash;
    previousTick = event.tick;
    expectedSequence += 1;
  }

  if (expectedTerminalHash !== undefined && previousHash !== expectedTerminalHash) {
    return { hash: previousHash, validChain: false, brokenAt: events[events.length - 1]!.sequence, reason: "terminal_hash_mismatch" };
  }
  return { hash: previousHash, validChain: true, brokenAt: null };
}

export function verifyPlayerChain(events: readonly PlayerEventEnvelope[], expectedTerminalHash?: string): ChainVerifyResult {
  if (events.length === 0) {
    return { hash: "", validChain: false, brokenAt: 0, reason: "empty_stream" };
  }
  let previousHash = GENESIS_PREVIOUS_HASH;
  let previousTick = Number.NEGATIVE_INFINITY;
  let expectedSequence = 0;
  const sessionId = events[0]!.sessionId;

  for (const event of events) {
    if (event.stream !== "player") {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "invalid_stream" };
    }
    if (event.sessionId !== sessionId) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "session_mismatch" };
    }
    if (event.sequence !== expectedSequence) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "sequence_gap" };
    }
    if (!Number.isInteger(event.tick) || event.tick < previousTick) {
      return {
        hash: previousHash,
        validChain: false,
        brokenAt: event.sequence,
        reason: event.tick < previousTick ? "tick_rollback" : "invalid_tick",
      };
    }
    if (event.previousHash !== previousHash) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "previous_hash_mismatch" };
    }
    const expected = playerEventHash(event);
    if (event.hash !== expected) {
      return { hash: previousHash, validChain: false, brokenAt: event.sequence, reason: "hash_mismatch" };
    }
    previousHash = event.hash;
    previousTick = event.tick;
    expectedSequence += 1;
  }

  if (expectedTerminalHash !== undefined && previousHash !== expectedTerminalHash) {
    return { hash: previousHash, validChain: false, brokenAt: events[events.length - 1]!.sequence, reason: "terminal_hash_mismatch" };
  }
  return { hash: previousHash, validChain: true, brokenAt: null };
}

interface CommandIssuedPayloadShape {
  commandId: string;
  commandName: string;
  idempotencyKey: string;
  issuedTick: number;
  target: string | null;
  params: Record<string, unknown>;
}

/** Reimplements `deriveCommandTrace` from `packages/simulation/src/artifact.ts`. */
export function deriveCommandTrace(events: readonly ReplayTruthEvent[]): ReplayCommandTraceEntry[] {
  const pending = new Map<string, { sequence: number; payload: CommandIssuedPayloadShape }>();
  const trace: ReplayCommandTraceEntry[] = [];

  for (const event of events) {
    if (event.kind === "CommandIssued") {
      const payload = event.payload as unknown as CommandIssuedPayloadShape;
      pending.set(payload.commandId, { sequence: event.sequence, payload });
      continue;
    }
    if (event.kind === "CommandAccepted") {
      const payload = event.payload as unknown as { commandId: string; idempotencyKey: string; etaTick: number | null };
      const entry = pending.get(payload.commandId);
      if (!entry) {
        continue;
      }
      trace.push({
        sequence: entry.sequence,
        commandId: payload.commandId,
        commandName: entry.payload.commandName,
        idempotencyKey: entry.payload.idempotencyKey,
        issuedTick: entry.payload.issuedTick,
        target: entry.payload.target,
        params: entry.payload.params,
        outcome: "accepted",
        errorCode: null,
        errorMessage: null,
        etaTick: payload.etaTick,
      });
      pending.delete(payload.commandId);
      continue;
    }
    if (event.kind === "CommandRejected") {
      const payload = event.payload as unknown as { commandId: string; reason: string; code: string };
      const entry = pending.get(payload.commandId);
      if (!entry) {
        continue;
      }
      trace.push({
        sequence: entry.sequence,
        commandId: payload.commandId,
        commandName: entry.payload.commandName,
        idempotencyKey: entry.payload.idempotencyKey,
        issuedTick: entry.payload.issuedTick,
        target: entry.payload.target,
        params: entry.payload.params,
        outcome: "rejected",
        errorCode: payload.code,
        errorMessage: payload.reason,
        etaTick: null,
      });
      pending.delete(payload.commandId);
    }
  }

  return trace.sort((a, b) => a.sequence - b.sequence);
}

/** Reimplements `deriveAssessmentTrace` from `packages/simulation/src/artifact.ts`. */
export function deriveAssessmentTrace(playerEvents: readonly PlayerEventEnvelope[]): ReplayAssessmentTraceEntry[] {
  const out: ReplayAssessmentTraceEntry[] = [];
  for (const event of playerEvents) {
    if (event.kind === "AssessmentSubmitted") {
      const assessment = (event.payload as { assessment: ReplayAssessmentTraceEntry }).assessment;
      out.push({ ...assessment });
    }
  }
  return out;
}

function withoutArtifactHash(artifact: ReplayArtifact): Omit<ReplayArtifact, "artifactHash"> {
  const { artifactHash, ...rest } = artifact;
  void artifactHash;
  return rest;
}

function checkSingletonTerminal(
  kinds: readonly string[],
  kind: string,
  position: "first" | "last",
  label: string,
  reasons: string[],
): void {
  const occurrences = kinds.reduce((n, value) => (value === kind ? n + 1 : n), 0);
  if (occurrences === 0) {
    reasons.push(`${label}: stream contains no ${kind}`);
    return;
  }
  if (occurrences > 1) {
    reasons.push(`${label}: stream contains ${occurrences} ${kind} events, expected exactly 1`);
  }
  const index = position === "first" ? 0 : kinds.length - 1;
  if (kinds[index] !== kind) {
    reasons.push(
      `${label}: ${position} event is ${String(kinds[index])}, expected ${kind}` +
        (position === "last" ? " (nothing may follow the terminal event)" : ""),
    );
  }
}

function deriveActiveIncidents(truthEvents: readonly ReplayTruthEvent[]): string[] {
  const active = new Set<string>();
  for (const event of truthEvents) {
    if (event.kind === "TrueIncidentOccurred" || event.kind === "IncidentChained") {
      active.add((event.payload as { incidentId: string }).incidentId);
    } else if (event.kind === "IncidentResolved") {
      active.delete((event.payload as { incidentId: string }).incidentId);
    }
  }
  return [...active].sort();
}

function derivePlayerTerminalCounts(playerEvents: readonly PlayerEventEnvelope[]): {
  claimCount: number;
  evidenceCount: number;
} {
  const claimIds = new Set<string>();
  let evidenceCount = 0;
  for (const event of playerEvents) {
    if (event.kind === "ClaimUpdated") {
      claimIds.add((event.payload as { claim: { id: string } }).claim.id);
    } else if (event.kind === "EvidenceRecorded") {
      evidenceCount += 1;
    }
  }
  return { claimCount: claimIds.size, evidenceCount };
}

function collectSemanticReasons(artifact: ReplayArtifact): string[] {
  const reasons: string[] = [];
  const sessionId = artifact.identity.sessionId;
  const truthKinds = artifact.truth.events.map((e) => e.kind);
  const playerKinds = artifact.player.events.map((e) => e.kind);

  checkSingletonTerminal(truthKinds, "ScenarioStarted", "first", "truth stream", reasons);
  checkSingletonTerminal(truthKinds, "ScenarioCompleted", "last", "truth stream", reasons);
  checkSingletonTerminal(playerKinds, "SessionStarted", "first", "player stream", reasons);
  checkSingletonTerminal(playerKinds, "RunCompleted", "last", "player stream", reasons);

  for (const event of artifact.truth.events) {
    if (!ALLOWED_TRUTH_KINDS.has(event.kind)) {
      reasons.push(`truth stream: disallowed kind ${event.kind}`);
    }
    if (event.sessionId !== sessionId) {
      reasons.push(`truth seq ${event.sequence}: sessionId does not match identity.sessionId`);
    }
  }
  for (const event of artifact.player.events) {
    if (!ALLOWED_PLAYER_KINDS.has(event.kind)) {
      reasons.push(`player stream: disallowed kind ${event.kind}`);
    }
    if (event.sessionId !== sessionId) {
      reasons.push(`player seq ${event.sequence}: sessionId does not match identity.sessionId`);
    }
  }

  if (!SHA256_HEX.test(artifact.identity.scenarioDigest)) {
    reasons.push("identity.scenarioDigest is not a sha256 hex digest");
  }
  if (!SHA256_HEX.test(artifact.stateDigest)) {
    reasons.push("stateDigest is not a sha256 hex digest");
  }
  if (!Number.isInteger(artifact.identity.engineProtocolVersion) || artifact.identity.engineProtocolVersion < 0) {
    reasons.push("identity.engineProtocolVersion must be a non-negative integer");
  }

  const started = artifact.truth.events[0];
  if (started?.kind === "ScenarioStarted") {
    const payload = started.payload as { scenarioId?: string; seed?: number; totalTicks?: number };
    if (payload.scenarioId !== artifact.identity.scenarioId) {
      reasons.push("identity.scenarioId does not match ScenarioStarted.scenarioId");
    }
    if (payload.seed !== artifact.identity.seed) {
      reasons.push("identity.seed does not match ScenarioStarted.seed");
    }
    if (payload.totalTicks !== artifact.identity.totalTicks) {
      reasons.push("identity.totalTicks does not match ScenarioStarted.totalTicks");
    }
  }

  const playerStarted = artifact.player.events[0];
  if (playerStarted?.kind === "SessionStarted") {
    const payload = playerStarted.payload as { scenarioId?: string; seed?: number; totalTicks?: number };
    if (payload.scenarioId !== artifact.identity.scenarioId) {
      reasons.push("identity.scenarioId does not match SessionStarted.scenarioId");
    }
    if (payload.seed !== artifact.identity.seed) {
      reasons.push("identity.seed does not match SessionStarted.seed");
    }
    if (payload.totalTicks !== artifact.identity.totalTicks) {
      reasons.push("identity.totalTicks does not match SessionStarted.totalTicks");
    }
  }

  const completed = artifact.truth.events[artifact.truth.events.length - 1];
  if (completed?.kind === "ScenarioCompleted") {
    const payload = completed.payload as { finalScore?: { total: number }; finalTick?: number };
    if (payload.finalTick !== artifact.finalTick) {
      reasons.push("finalTick mismatch vs ScenarioCompleted");
    }
    if (payload.finalScore && payload.finalScore.total !== artifact.scoreTotal) {
      reasons.push("scoreTotal mismatch vs ScenarioCompleted");
    }
    if (artifact.finalTick !== artifact.identity.totalTicks) {
      reasons.push("finalTick does not equal identity.totalTicks");
    }
  }

  const runCompleted = artifact.player.events[artifact.player.events.length - 1];
  if (runCompleted?.kind === "RunCompleted") {
    const payload = runCompleted.payload as {
      finalTick?: number;
      scoreTotal?: number;
      claimCount?: number;
      evidenceCount?: number;
    };
    if (payload.finalTick !== artifact.finalTick) {
      reasons.push("RunCompleted.finalTick does not match artifact finalTick");
    }
    if (payload.scoreTotal !== artifact.scoreTotal) {
      reasons.push("RunCompleted.scoreTotal does not match artifact scoreTotal");
    }
    const derived = derivePlayerTerminalCounts(artifact.player.events);
    if (payload.claimCount !== derived.claimCount) {
      reasons.push(
        `RunCompleted.claimCount ${String(payload.claimCount)} does not match derived claim count ${derived.claimCount}`,
      );
    }
    if (payload.evidenceCount !== derived.evidenceCount) {
      reasons.push(
        `RunCompleted.evidenceCount ${String(payload.evidenceCount)} does not match derived evidence count ${derived.evidenceCount}`,
      );
    }
  }

  // Exact 1:1:1 — CommandIssued ↔ truth outcome ↔ player CommandResult.
  type Outcome = { state: "accepted" | "rejected"; idempotencyKey: string; sessionId: string };
  const issued = new Map<string, { idempotencyKey: string; sessionId: string }>();
  const outcomes = new Map<string, Outcome>();
  const playerResults = new Map<string, { state: "accepted" | "rejected"; idempotencyKey: string; sessionId: string; count: number }>();
  const seenIdempotency = new Set<string>();

  for (const event of artifact.truth.events) {
    if (event.kind === "CommandIssued") {
      const payload = event.payload as { commandId: string; idempotencyKey: string };
      if (issued.has(payload.commandId)) {
        reasons.push(`duplicate CommandIssued commandId ${payload.commandId}`);
      }
      if (seenIdempotency.has(payload.idempotencyKey)) {
        reasons.push(`duplicate CommandIssued idempotencyKey ${payload.idempotencyKey}`);
      }
      seenIdempotency.add(payload.idempotencyKey);
      issued.set(payload.commandId, { idempotencyKey: payload.idempotencyKey, sessionId: event.sessionId });
    }
    if (event.kind === "CommandAccepted" || event.kind === "CommandRejected") {
      const payload = event.payload as { commandId: string; idempotencyKey?: string };
      const state = event.kind === "CommandAccepted" ? "accepted" : "rejected";
      if (outcomes.has(payload.commandId)) {
        reasons.push(`truth has duplicate outcomes for commandId ${payload.commandId}`);
      }
      const issuedMeta = issued.get(payload.commandId);
      const idempotencyKey =
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : issuedMeta?.idempotencyKey;
      if (!issuedMeta) {
        reasons.push(`truth outcome for unknown commandId ${payload.commandId}`);
      } else if (!idempotencyKey) {
        reasons.push(`truth outcome missing idempotencyKey for commandId ${payload.commandId}`);
      } else {
        if (idempotencyKey !== issuedMeta.idempotencyKey) {
          reasons.push(`truth outcome idempotencyKey does not match CommandIssued for ${payload.commandId}`);
        }
        outcomes.set(payload.commandId, { state, idempotencyKey, sessionId: event.sessionId });
      }
    }
  }

  for (const commandId of issued.keys()) {
    if (!outcomes.has(commandId)) {
      reasons.push(`CommandIssued ${commandId} has no truth terminal outcome`);
    }
  }

  for (const event of artifact.player.events) {
    if (event.kind !== "CommandResult") {
      continue;
    }
    const payload = event.payload as {
      commandId: string;
      state: "accepted" | "rejected";
      idempotencyKey: string;
    };
    const existing = playerResults.get(payload.commandId);
    if (existing) {
      existing.count += 1;
      reasons.push(`duplicate player CommandResult for commandId ${payload.commandId}`);
      continue;
    }
    playerResults.set(payload.commandId, {
      state: payload.state,
      idempotencyKey: payload.idempotencyKey,
      sessionId: event.sessionId,
      count: 1,
    });
  }

  for (const [commandId, outcome] of outcomes) {
    const player = playerResults.get(commandId);
    if (!player) {
      reasons.push(`truth outcome for commandId ${commandId} has no matching player CommandResult`);
      continue;
    }
    if (player.state !== outcome.state) {
      reasons.push(
        `player CommandResult state ${player.state} contradicts truth outcome ${outcome.state} for commandId ${commandId}`,
      );
    }
    if (player.idempotencyKey !== outcome.idempotencyKey) {
      reasons.push(`player CommandResult idempotencyKey does not match truth for ${commandId}`);
    }
    if (player.sessionId !== sessionId || outcome.sessionId !== sessionId) {
      reasons.push(`command ${commandId} sessionId does not match identity.sessionId`);
    }
  }

  for (const commandId of playerResults.keys()) {
    if (!outcomes.has(commandId)) {
      reasons.push(`player CommandResult for unknown commandId ${commandId}`);
    }
  }

  const handledFromLog = artifact.truth.events
    .filter((event) => event.kind === "IncidentResolved")
    .map((event) => (event.payload as { incidentId: string }).incidentId);
  if (canonicalJsonReplay([...handledFromLog].sort()) !== canonicalJsonReplay([...artifact.handledIncidents].sort())) {
    reasons.push("handledIncidents does not match IncidentResolved events in the truth log");
  }

  const activeFromLog = deriveActiveIncidents(artifact.truth.events);
  if (canonicalJsonReplay(activeFromLog) !== canonicalJsonReplay([...artifact.activeIncidents].sort())) {
    reasons.push("activeIncidents does not match derived truth incident lifecycle");
  }

  return reasons;
}

/**
 * Browser verification: envelope/hash integrity + semantic bindings.
 * Never claims full independent replay. Full verification requires the CLI:
 * `null-city-run verify --artifact <path>`.
 */
export function verifyReplayArtifact(artifact: ReplayArtifact): ReplayVerifyResult {
  const integrityReasons: string[] = [];

  if (artifact.format !== "null-city-run-artifact") {
    integrityReasons.push(`unknown format ${String(artifact.format)}`);
  }
  if (artifact.version !== 2) {
    integrityReasons.push(`unsupported version ${String(artifact.version)}`);
  }

  try {
    const expectedHash = sha256Hex(canonicalJsonReplay(withoutArtifactHash(artifact)));
    if (artifact.artifactHash !== expectedHash) {
      integrityReasons.push("artifactHash mismatch");
    }
  } catch (error) {
    if (error instanceof CanonicalJsonDepthError) {
      integrityReasons.push(error.message);
    } else {
      throw error;
    }
  }

  const truthChain = verifyTruthChain(artifact.truth.events, artifact.truthLogHash);
  if (!truthChain.validChain) {
    integrityReasons.push(`truth stream invalid: ${truthChain.reason ?? "unknown"}`);
  }
  if (artifact.eventCount !== artifact.truth.events.length) {
    integrityReasons.push("eventCount mismatch");
  }

  const playerChain = verifyPlayerChain(artifact.player.events, artifact.playerLogHash);
  if (!playerChain.validChain) {
    integrityReasons.push(`player stream invalid: ${playerChain.reason ?? "unknown"}`);
  }
  if (artifact.playerEventCount !== artifact.player.events.length) {
    integrityReasons.push("playerEventCount mismatch");
  }

  const completed = [...artifact.truth.events].reverse().find((event) => event.kind === "ScenarioCompleted");
  if (!completed) {
    integrityReasons.push("missing ScenarioCompleted terminal truth event");
  } else {
    const payload = completed.payload as { finalScore?: { total: number }; finalTick?: number };
    if (!payload.finalScore) {
      integrityReasons.push("ScenarioCompleted missing finalScore");
    } else {
      try {
        if (sha256Hex(canonicalJsonReplay(payload.finalScore)) !== artifact.scoreDigest) {
          integrityReasons.push("scoreDigest mismatch vs ScenarioCompleted");
        }
      } catch (error) {
        if (error instanceof CanonicalJsonDepthError) {
          integrityReasons.push(error.message);
        } else {
          throw error;
        }
      }
      if (payload.finalScore.total !== artifact.scoreTotal) {
        integrityReasons.push("scoreTotal mismatch vs ScenarioCompleted");
      }
    }
    if (payload.finalTick !== artifact.finalTick) {
      integrityReasons.push("finalTick mismatch vs ScenarioCompleted");
    }
  }

  try {
    const rebuiltCommandTrace = deriveCommandTrace(artifact.truth.events);
    if (canonicalJsonReplay(rebuiltCommandTrace) !== canonicalJsonReplay(artifact.commandTrace)) {
      integrityReasons.push("commandTrace does not match truth log");
    }

    const rebuiltAssessments = deriveAssessmentTrace(artifact.player.events);
    if (canonicalJsonReplay(rebuiltAssessments) !== canonicalJsonReplay(artifact.assessmentTrace)) {
      integrityReasons.push("assessmentTrace does not match player log");
    }
  } catch (error) {
    if (error instanceof CanonicalJsonDepthError) {
      integrityReasons.push(error.message);
    } else {
      throw error;
    }
  }

  let semanticReasons: string[] = [];
  try {
    semanticReasons = collectSemanticReasons(artifact);
  } catch (error) {
    if (error instanceof CanonicalJsonDepthError) {
      semanticReasons = [error.message];
    } else {
      throw error;
    }
  }
  const reasons = [...integrityReasons, ...semanticReasons];
  const integrityOk = integrityReasons.length === 0;
  const semanticBindingsOk = semanticReasons.length === 0;
  const status: ReplayVerificationStatus = integrityOk && semanticBindingsOk ? "PARTIAL" : "FAIL";

  return {
    status,
    integrityOk,
    semanticBindingsOk,
    truthReplayChecked: false,
    playerReplayChecked: false,
    authenticity: "none",
    reasons,
    scopes: {
      integrity: integrityOk ? "PASS" : "FAIL",
      semanticBindings: semanticBindingsOk ? "PASS" : "FAIL",
      truthReplay: "NOT_CHECKED",
      playerReplay: "NOT_CHECKED",
      stateDigest: "NOT_CHECKED",
      scenarioContentDigest: "NOT_CHECKED",
      engineProtocolCompatibility: "NOT_CHECKED",
      publicActionLedger: "NOT_CHECKED",
      authenticity: "NOT_CHECKED",
    },
    stateDigestStatus: "NOT_CHECKED",
    scenarioContentDigestStatus: "NOT_CHECKED",
    engineProtocolCompatibilityStatus: "NOT_CHECKED",
    publicActionLedgerStatus: "NOT_CHECKED",
  };
}

/** CLI command for authoritative full verification (truth + player replay). */
export const FULL_VERIFY_CLI_HINT =
  "null-city-run verify --artifact <path>  # loads compiled scenario; truth + player projection replay";

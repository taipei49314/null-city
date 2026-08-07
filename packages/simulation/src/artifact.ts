import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  canonicalJson,
  sha256,
  verifyEventStream,
  verifyPlayerEventStream,
  type EventEnvelope,
  type PlayerEventEnvelope,
} from "@null-city/contracts/truth";
import type { Scenario } from "@null-city/scenario-schema";

import { ENGINE_PROTOCOL_VERSION, scenarioDigest, type RunResult } from "./engine.js";
import type { PublicAction } from "./public-actions.js";
import { replayFromPublicActions } from "./public-replay.js";
import { replayResult } from "./replay.js";

export const RUN_ARTIFACT_FORMAT = "null-city-run-artifact";
/** Artifact v2: includes a canonical public-action ledger for player rebuild. */
export const RUN_ARTIFACT_VERSION = 2 as const;

/**
 * Hard ceiling on artifact JSON accepted by the strict parser. Truth and
 * player logs are both fully embedded, so a long run with many observations
 * can be large; this bound exists to reject hostile or corrupted input
 * before it is ever handed to `JSON.parse`.
 */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export interface ArtifactSignature {
  algorithm: string;
  keyId: string;
  signature: string;
}

export interface CommandTraceEntry {
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

export interface AssessmentTraceEntry {
  id: string;
  claimId: string;
  probability: number;
  confidence: number;
  rationale?: string;
  submittedTick: number;
}

export interface RunArtifactIdentity {
  sessionId: string;
  scenarioId: string;
  scenarioDigest: string;
  engineProtocolVersion: number;
  seed: number;
  totalTicks: number;
}

/**
 * Canonical, versioned run artifact.
 *
 * Extends the M0 run receipt (`receipt.ts`) with full command/assessment
 * traces and the complete truth + player event logs, so a completed run can
 * be independently re-verified and replayed in the Replay Lab without any
 * additional server trust. Truth is only ever embedded here because the
 * artifact can only be built for a run whose truth log already ends in
 * `ScenarioCompleted` — see `buildRunArtifact`.
 */
export interface RunArtifact {
  format: typeof RUN_ARTIFACT_FORMAT;
  version: typeof RUN_ARTIFACT_VERSION;
  identity: RunArtifactIdentity;
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
  commandTrace: CommandTraceEntry[];
  assessmentTrace: AssessmentTraceEntry[];
  /**
   * Player-originated actions in submission order. Required to regenerate the
   * player projection; truth alone is not sufficient (M10 P0-02).
   */
  publicActionLedger: PublicAction[];
  truth: { events: EventEnvelope[] };
  player: { events: PlayerEventEnvelope[] };
  /** Detached signature metadata. Always null unless an external signer attached one. */
  signature: ArtifactSignature | null;
  artifactHash: string;
}

export interface BuildArtifactInput {
  result: RunResult;
  scenarioDigest: string;
  truthEvents: readonly EventEnvelope[];
  playerEvents: readonly PlayerEventEnvelope[];
  publicActionLedger?: readonly PublicAction[];
  signature?: ArtifactSignature | null;
}

function scoreDigestOf(score: RunResult["score"]): string {
  return sha256(canonicalJson(score));
}

interface CommandIssuedPayloadShape {
  commandId: string;
  commandName: string;
  idempotencyKey: string;
  issuedTick: number;
  target: string | null;
  params: Record<string, unknown>;
}

export interface CommandTraceDerivation {
  trace: CommandTraceEntry[];
  /** `CommandIssued` with no terminal outcome */
  unmatchedCommandIds: string[];
  /** a `commandId` issued more than once, or resolved more than once */
  duplicateCommandIds: string[];
  /** an outcome event referencing a `commandId` that was never issued */
  orphanOutcomeCommandIds: string[];
}

/**
 * Pairs each `CommandIssued` truth event with its terminal outcome
 * (`CommandAccepted` | `CommandRejected`) into one normalized trace entry.
 *
 * Audit finding P0-02: the inherited version silently dropped unmatched,
 * duplicated and orphaned outcomes, so an artifact could omit an issued
 * command and still verify. Anomalies are now reported to the caller.
 */
function deriveCommandTraceDetailed(events: readonly EventEnvelope[]): CommandTraceDerivation {
  const pending = new Map<string, { sequence: number; payload: CommandIssuedPayloadShape }>();
  const trace: CommandTraceEntry[] = [];
  const seenCommandIds = new Set<string>();
  const resolvedCommandIds = new Set<string>();
  const duplicateCommandIds: string[] = [];
  const orphanOutcomeCommandIds: string[] = [];

  for (const event of events) {
    if (event.kind === "CommandIssued") {
      const payload = event.payload as CommandIssuedPayloadShape;
      if (seenCommandIds.has(payload.commandId)) {
        duplicateCommandIds.push(payload.commandId);
      }
      seenCommandIds.add(payload.commandId);
      pending.set(payload.commandId, { sequence: event.sequence, payload });
      continue;
    }
    if (event.kind === "CommandAccepted") {
      const payload = event.payload as { commandId: string; idempotencyKey: string; etaTick: number | null };
      const entry = pending.get(payload.commandId);
      if (!entry) {
        if (resolvedCommandIds.has(payload.commandId)) {
          duplicateCommandIds.push(payload.commandId);
        } else {
          orphanOutcomeCommandIds.push(payload.commandId);
        }
        continue;
      }
      resolvedCommandIds.add(payload.commandId);
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
      const payload = event.payload as { commandId: string; reason: string; code: string };
      const entry = pending.get(payload.commandId);
      if (!entry) {
        if (resolvedCommandIds.has(payload.commandId)) {
          duplicateCommandIds.push(payload.commandId);
        } else {
          orphanOutcomeCommandIds.push(payload.commandId);
        }
        continue;
      }
      resolvedCommandIds.add(payload.commandId);
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

  return {
    trace: trace.sort((a, b) => a.sequence - b.sequence),
    unmatchedCommandIds: [...pending.keys()],
    duplicateCommandIds,
    orphanOutcomeCommandIds,
  };
}

function deriveCommandTrace(events: readonly EventEnvelope[]): CommandTraceEntry[] {
  return deriveCommandTraceDetailed(events).trace;
}

function deriveAssessmentTrace(playerEvents: readonly PlayerEventEnvelope[]): AssessmentTraceEntry[] {
  const out: AssessmentTraceEntry[] = [];
  for (const event of playerEvents) {
    if (event.kind === "AssessmentSubmitted") {
      const assessment = (event.payload as { assessment: AssessmentTraceEntry }).assessment;
      out.push({ ...assessment });
    }
  }
  return out;
}

function withoutArtifactHash(artifact: RunArtifact): Omit<RunArtifact, "artifactHash"> {
  const { artifactHash, ...rest } = artifact;
  void artifactHash;
  return rest;
}

/**
 * Builds a run artifact from a completed engine run.
 *
 * Truth is only ever embedded because this throws unless `truthEvents`
 * already ends in `ScenarioCompleted` — an active/incomplete run can never
 * produce an artifact, which is what keeps the "truth only after
 * completion" boundary a structural property of this function rather than
 * a convention callers must remember.
 */
export function buildRunArtifact(input: BuildArtifactInput): RunArtifact {
  const { result, scenarioDigest, truthEvents, playerEvents, signature } = input;
  const publicActionLedger = structuredClone(input.publicActionLedger ?? []) as PublicAction[];

  const truth = verifyEventStream([...truthEvents], {
    expectedSessionId: result.sessionId,
    requireNonEmpty: true,
  });
  if (!truth.validChain) {
    throw new Error(`cannot build run artifact: truth stream invalid (${truth.reason ?? "unknown"})`);
  }

  const started = truthEvents[0];
  if (!started || started.kind !== "ScenarioStarted") {
    throw new Error("cannot build run artifact: truth log does not begin with ScenarioStarted");
  }
  const completed = truthEvents[truthEvents.length - 1];
  if (!completed || completed.kind !== "ScenarioCompleted") {
    throw new Error(
      "cannot build run artifact: truth log does not end in ScenarioCompleted (run is not completed)",
    );
  }
  const startedPayload = started.payload as { totalTicks: number };

  const player = verifyPlayerEventStream([...playerEvents], {
    expectedSessionId: result.sessionId,
    requireNonEmpty: true,
  });
  if (!player.validChain) {
    throw new Error(`cannot build run artifact: player stream invalid (${player.reason ?? "unknown"})`);
  }
  const playerStarted = playerEvents[0];
  if (!playerStarted || playerStarted.kind !== "SessionStarted") {
    throw new Error("cannot build run artifact: player log does not begin with SessionStarted");
  }
  const playerTerminal = playerEvents[playerEvents.length - 1];
  if (!playerTerminal || playerTerminal.kind !== "RunCompleted") {
    throw new Error(
      `cannot build run artifact: player log ends in ${String(playerTerminal?.kind)}, expected RunCompleted`,
    );
  }

  const body: Omit<RunArtifact, "artifactHash"> = {
    format: RUN_ARTIFACT_FORMAT,
    version: RUN_ARTIFACT_VERSION,
    identity: {
      sessionId: result.sessionId,
      scenarioId: result.scenarioId,
      scenarioDigest,
      engineProtocolVersion: ENGINE_PROTOCOL_VERSION,
      seed: result.seed,
      totalTicks: startedPayload.totalTicks,
    },
    finalTick: result.finalTick,
    eventCount: truthEvents.length,
    playerEventCount: playerEvents.length,
    truthLogHash: truth.hash,
    playerLogHash: player.hash,
    stateDigest: sha256(result.finalStateDigest),
    scoreDigest: scoreDigestOf(result.score),
    scoreTotal: result.score.total,
    handledIncidents: [...result.handledIncidents],
    activeIncidents: [...result.activeIncidents],
    commandTrace: deriveCommandTrace(truthEvents),
    assessmentTrace: deriveAssessmentTrace(playerEvents),
    publicActionLedger,
    truth: { events: structuredClone(truthEvents) as EventEnvelope[] },
    player: { events: structuredClone(playerEvents) as PlayerEventEnvelope[] },
    signature: signature ?? null,
  };
  const artifactHash = sha256(canonicalJson(body));
  return { ...body, artifactHash };
}

export function serializeArtifact(artifact: RunArtifact): string {
  return canonicalJson(artifact);
}

export function saveArtifact(path: string, artifact: RunArtifact): void {
  writeFileSync(path, serializeArtifact(artifact), { encoding: "utf8" });
}

export class ArtifactParseError extends Error {}

function assertArtifactShape(value: unknown): RunArtifact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactParseError("artifact root must be an object");
  }
  const obj = value as Record<string, unknown>;
  if (obj["format"] !== RUN_ARTIFACT_FORMAT) {
    throw new ArtifactParseError(`unknown artifact format ${JSON.stringify(obj["format"])}`);
  }
  if (obj["version"] !== RUN_ARTIFACT_VERSION) {
    throw new ArtifactParseError(`unsupported artifact version ${JSON.stringify(obj["version"])}`);
  }
  const identity = obj["identity"];
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    throw new ArtifactParseError("artifact missing identity");
  }
  const truth = obj["truth"] as { events?: unknown } | undefined;
  if (!truth || !Array.isArray(truth.events)) {
    throw new ArtifactParseError("artifact missing truth.events array");
  }
  const player = obj["player"] as { events?: unknown } | undefined;
  if (!player || !Array.isArray(player.events)) {
    throw new ArtifactParseError("artifact missing player.events array");
  }
  if (!Array.isArray(obj["commandTrace"])) {
    throw new ArtifactParseError("artifact missing commandTrace array");
  }
  if (!Array.isArray(obj["assessmentTrace"])) {
    throw new ArtifactParseError("artifact missing assessmentTrace array");
  }
  if (!Array.isArray(obj["publicActionLedger"])) {
    throw new ArtifactParseError("artifact missing publicActionLedger array (artifact v2)");
  }
  if (typeof obj["artifactHash"] !== "string" || obj["artifactHash"].length === 0) {
    throw new ArtifactParseError("artifact missing artifactHash");
  }
  if (typeof obj["truthLogHash"] !== "string" || typeof obj["playerLogHash"] !== "string") {
    throw new ArtifactParseError("artifact missing truthLogHash/playerLogHash");
  }
  if (obj["signature"] !== null && typeof obj["signature"] !== "undefined" && typeof obj["signature"] !== "object") {
    throw new ArtifactParseError("artifact signature must be an object or null");
  }
  return obj as unknown as RunArtifact;
}

/**
 * Strict runtime parser with a bounded input size. Rejects anything that is
 * not valid JSON in the expected shape before any further processing.
 */
export function parseArtifactJson(raw: string): RunArtifact {
  if (typeof raw !== "string") {
    throw new ArtifactParseError("artifact input must be a string");
  }
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_ARTIFACT_BYTES) {
    throw new ArtifactParseError(
      `artifact exceeds maximum accepted size of ${MAX_ARTIFACT_BYTES} bytes (got ${byteLength})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ArtifactParseError("artifact is not valid JSON");
  }
  return assertArtifactShape(parsed);
}

export function loadArtifact(path: string): RunArtifact {
  if (!existsSync(path)) {
    throw new Error(`artifact file does not exist: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  return parseArtifactJson(raw);
}

export interface ArtifactVerifyResult {
  ok: boolean;
  reasons: string[];
  /** true when a deterministic truth re-simulation was run */
  replayChecked: boolean;
  /** true when the player projection was rebuilt from the public-action ledger */
  playerReplayChecked: boolean;
  /** envelope / hash-chain integrity passed (independent of replay) */
  integrityOk: boolean;
  /** authenticity: only meaningful when an externally trusted signature exists */
  authenticity: "none" | "metadata-only";
}

export interface VerifyArtifactOptions {
  /**
   * Compiled scenario for the artifact's `identity.scenarioId`. When supplied
   * and its digest matches `identity.scenarioDigest`, the verifier re-runs the
   * whole scenario from `seed` + the public-action ledger and requires the
   * regenerated truth and player roots to match the artifact (M10 P0-02).
   */
  scenario?: Scenario;
  /** Fail verification when no scenario was supplied to replay against. */
  requireReplay?: boolean;
}

/** Exactly-one-of-kind check with a stable failure reason. */
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

/**
 * Independently verifies a run artifact: hash chains for both truth and
 * player logs, the terminal `ScenarioCompleted` binding, command/assessment
 * trace consistency against the embedded logs, and the artifact's own
 * content hash. Like `verifyReceipt`, a valid chain is tamper-evident only —
 * authenticity requires an externally trusted root or signature, which this
 * repository does not provide.
 */
export function verifyRunArtifact(
  artifact: RunArtifact,
  options: VerifyArtifactOptions = {},
): ArtifactVerifyResult {
  const reasons: string[] = [];
  let replayChecked = false;
  let playerReplayChecked = false;
  if (artifact.format !== RUN_ARTIFACT_FORMAT) {
    reasons.push(`unknown format ${String(artifact.format)}`);
  }
  if (artifact.version !== RUN_ARTIFACT_VERSION) {
    reasons.push(`unsupported version ${String(artifact.version)}`);
  }

  const expectedHash = sha256(canonicalJson(withoutArtifactHash(artifact)));
  if (artifact.artifactHash !== expectedHash) {
    reasons.push("artifactHash mismatch");
  }

  const truthChain = verifyEventStream(artifact.truth.events, {
    expectedSessionId: artifact.identity.sessionId,
    expectedTerminalHash: artifact.truthLogHash,
    requireNonEmpty: true,
  });
  if (!truthChain.validChain) {
    reasons.push(`truth stream invalid: ${truthChain.reason ?? "unknown"}`);
  }
  if (artifact.eventCount !== artifact.truth.events.length) {
    reasons.push("eventCount mismatch");
  }

  const playerChain = verifyPlayerEventStream(artifact.player.events, {
    expectedSessionId: artifact.identity.sessionId,
    expectedTerminalHash: artifact.playerLogHash,
    requireNonEmpty: true,
  });
  if (!playerChain.validChain) {
    reasons.push(`player stream invalid: ${playerChain.reason ?? "unknown"}`);
  }
  if (artifact.playerEventCount !== artifact.player.events.length) {
    reasons.push("playerEventCount mismatch");
  }

  // --- terminal structure --------------------------------------------------
  // A hash chain says "these events are in this order"; it says nothing about
  // whether the order is legal. The inherited verifier searched for the *last*
  // `ScenarioCompleted` anywhere in the stream, so an event appended after the
  // terminal event was accepted (ART-03), a missing `RunCompleted` was accepted
  // (ART-02), and the shipped baseline artifact itself ended in
  // `OwnTeamUpdated`.
  const truthKinds = artifact.truth.events.map((event) => event.kind);
  checkSingletonTerminal(truthKinds, "ScenarioStarted", "first", "truth stream", reasons);
  checkSingletonTerminal(truthKinds, "ScenarioCompleted", "last", "truth stream", reasons);

  const playerKinds = artifact.player.events.map((event) => event.kind);
  checkSingletonTerminal(playerKinds, "SessionStarted", "first", "player stream", reasons);
  checkSingletonTerminal(playerKinds, "RunCompleted", "last", "player stream", reasons);

  // --- identity cross-binding ----------------------------------------------
  // Every identity field the artifact header asserts must also be asserted by
  // an event inside the artifact. Rehashing the whole artifact cannot repair a
  // contradiction between two fields that both have to be forged consistently
  // (audit finding ART-01).
  const started = artifact.truth.events[0];
  if (started && started.kind === "ScenarioStarted") {
    const payload = started.payload as { scenarioId?: string; seed?: number; totalTicks?: number };
    if (payload.scenarioId !== artifact.identity.scenarioId) {
      reasons.push(
        `identity.scenarioId ${JSON.stringify(artifact.identity.scenarioId)} does not match ` +
          `ScenarioStarted.scenarioId ${JSON.stringify(payload.scenarioId)}`,
      );
    }
    if (payload.seed !== artifact.identity.seed) {
      reasons.push(
        `identity.seed ${String(artifact.identity.seed)} does not match ScenarioStarted.seed ${String(payload.seed)}`,
      );
    }
    if (payload.totalTicks !== artifact.identity.totalTicks) {
      reasons.push(
        `identity.totalTicks ${String(artifact.identity.totalTicks)} does not match ` +
          `ScenarioStarted.totalTicks ${String(payload.totalTicks)}`,
      );
    }
  }
  if (started && started.sessionId !== artifact.identity.sessionId) {
    reasons.push("identity.sessionId does not match the truth genesis event");
  }
  if (artifact.identity.engineProtocolVersion !== ENGINE_PROTOCOL_VERSION) {
    reasons.push(
      `identity.engineProtocolVersion ${String(artifact.identity.engineProtocolVersion)} is not supported ` +
        `(this build verifies protocol ${String(ENGINE_PROTOCOL_VERSION)})`,
    );
  }
  if (typeof artifact.identity.scenarioDigest !== "string" || !/^[0-9a-f]{64}$/.test(artifact.identity.scenarioDigest)) {
    reasons.push("identity.scenarioDigest is not a sha256 hex digest");
  }

  const playerStarted = artifact.player.events[0];
  if (playerStarted && playerStarted.kind === "SessionStarted") {
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
  if (completed && completed.kind === "ScenarioCompleted") {
    const payload = completed.payload as { finalScore?: RunResult["score"]; finalTick?: number };
    if (!payload.finalScore) {
      reasons.push("ScenarioCompleted missing finalScore");
    } else {
      if (scoreDigestOf(payload.finalScore) !== artifact.scoreDigest) {
        reasons.push("scoreDigest mismatch vs ScenarioCompleted");
      }
      if (payload.finalScore.total !== artifact.scoreTotal) {
        reasons.push("scoreTotal mismatch vs ScenarioCompleted");
      }
    }
    if (payload.finalTick !== artifact.finalTick) {
      reasons.push("finalTick mismatch vs ScenarioCompleted");
    }
    if (completed.tick !== artifact.finalTick) {
      reasons.push("ScenarioCompleted event tick does not match finalTick");
    }
    if (artifact.finalTick !== artifact.identity.totalTicks) {
      reasons.push(
        `finalTick ${String(artifact.finalTick)} does not equal totalTicks ${String(artifact.identity.totalTicks)}; ` +
          "a completed run always ends on its last tick",
      );
    }
  }

  const runCompleted = artifact.player.events[artifact.player.events.length - 1];
  if (runCompleted && runCompleted.kind === "RunCompleted") {
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
  }

  // --- traces ---------------------------------------------------------------
  const derivation = deriveCommandTraceDetailed(artifact.truth.events);
  if (canonicalJson(derivation.trace) !== canonicalJson(artifact.commandTrace)) {
    reasons.push("commandTrace does not match truth log");
  }
  if (derivation.unmatchedCommandIds.length > 0) {
    reasons.push(`command(s) issued with no terminal outcome: ${derivation.unmatchedCommandIds.join(",")}`);
  }
  if (derivation.duplicateCommandIds.length > 0) {
    reasons.push(`duplicate command id(s) in truth log: ${[...new Set(derivation.duplicateCommandIds)].join(",")}`);
  }
  if (derivation.orphanOutcomeCommandIds.length > 0) {
    reasons.push(
      `command outcome(s) for never-issued command id(s): ${[...new Set(derivation.orphanOutcomeCommandIds)].join(",")}`,
    );
  }

  const rebuiltAssessments = deriveAssessmentTrace(artifact.player.events);
  if (canonicalJson(rebuiltAssessments) !== canonicalJson(artifact.assessmentTrace)) {
    reasons.push("assessmentTrace does not match player log");
  }

  const handledFromLog = artifact.truth.events
    .filter((event) => event.kind === "IncidentResolved")
    .map((event) => (event.payload as { incidentId: string }).incidentId);
  if (canonicalJson([...handledFromLog].sort()) !== canonicalJson([...artifact.handledIncidents].sort())) {
    reasons.push("handledIncidents does not match IncidentResolved events in the truth log");
  }

  // Cross-bind every player CommandResult to exactly one truth outcome.
  crossBindCommandResults(artifact, reasons);

  // Snapshot integrity reasons before replay so CLI can report levels separately.
  const integrityReasonCount = reasons.length;

  // --- terminal state + player projection replay ----------------------------
  const replay = verifyByReplay(artifact, options, reasons);
  replayChecked = replay.truthChecked;
  playerReplayChecked = replay.playerChecked;
  if (options.requireReplay && !replay.truthChecked) {
    reasons.push(
      "full verification requires compiled scenario replay; no scenario supplied or replay could not run",
    );
  }

  if (artifact.signature !== null) {
    const signature = artifact.signature as Partial<ArtifactSignature> | null;
    if (
      !signature ||
      typeof signature.algorithm !== "string" ||
      typeof signature.keyId !== "string" ||
      typeof signature.signature !== "string"
    ) {
      reasons.push("signature metadata present but malformed");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    replayChecked,
    playerReplayChecked,
    integrityOk: reasons.slice(0, integrityReasonCount).length === 0,
    authenticity: artifact.signature ? "metadata-only" : "none",
  };
}

function crossBindCommandResults(artifact: RunArtifact, reasons: string[]): void {
  const outcomes = new Map<string, "accepted" | "rejected">();
  for (const event of artifact.truth.events) {
    if (event.kind === "CommandAccepted" || event.kind === "CommandRejected") {
      const commandId = (event.payload as { commandId: string }).commandId;
      const state = event.kind === "CommandAccepted" ? "accepted" : "rejected";
      if (outcomes.has(commandId)) {
        reasons.push(`truth has duplicate outcomes for commandId ${commandId}`);
      }
      outcomes.set(commandId, state);
    }
  }
  for (const event of artifact.player.events) {
    if (event.kind !== "CommandResult") {
      continue;
    }
    const payload = event.payload as { commandId: string; state: "accepted" | "rejected"; idempotencyKey: string };
    const truthState = outcomes.get(payload.commandId);
    if (!truthState) {
      reasons.push(`player CommandResult for unknown commandId ${payload.commandId}`);
      continue;
    }
    if (truthState !== payload.state) {
      reasons.push(
        `player CommandResult state ${payload.state} contradicts truth outcome ${truthState} for commandId ${payload.commandId}`,
      );
    }
    const issued = artifact.truth.events.find(
      (e) => e.kind === "CommandIssued" && (e.payload as { commandId: string }).commandId === payload.commandId,
    );
    if (issued) {
      const issuedKey = (issued.payload as { idempotencyKey: string }).idempotencyKey;
      if (issuedKey !== payload.idempotencyKey) {
        reasons.push(`player CommandResult idempotencyKey does not match CommandIssued for ${payload.commandId}`);
      }
    }
  }
}

/**
 * Re-simulates truth from the embedded event stream and independently rebuilds
 * the player projection from scenario + seed + publicActionLedger.
 */
function verifyByReplay(
  artifact: RunArtifact,
  options: VerifyArtifactOptions,
  reasons: string[],
): { truthChecked: boolean; playerChecked: boolean } {
  const scenario = options.scenario;
  if (!scenario) {
    return { truthChecked: false, playerChecked: false };
  }
  if (scenario.id !== artifact.identity.scenarioId) {
    reasons.push(
      `supplied scenario ${JSON.stringify(scenario.id)} is not the artifact's scenario ` +
        `${JSON.stringify(artifact.identity.scenarioId)}`,
    );
    return { truthChecked: false, playerChecked: false };
  }
  const digest = scenarioDigest(scenario);
  if (digest !== artifact.identity.scenarioDigest) {
    reasons.push("identity.scenarioDigest does not match the supplied compiled scenario");
    return { truthChecked: false, playerChecked: false };
  }

  let truthChecked = false;
  try {
    const replayed = replayResult(
      artifact.truth.events,
      scenario,
      artifact.identity.sessionId,
      artifact.identity.seed,
    );
    truthChecked = true;
    if (replayed.engine.eventLogHash !== artifact.truthLogHash) {
      reasons.push("deterministic replay produced a different truth log hash");
    }
    if (replayed.engine.eventLog.length !== artifact.eventCount) {
      reasons.push(
        `deterministic replay produced ${replayed.engine.eventLog.length} truth events, artifact claims ${artifact.eventCount}`,
      );
    }
    if (sha256(replayed.finalStateDigest) !== artifact.stateDigest) {
      reasons.push("stateDigest does not match the terminal state recomputed by deterministic replay");
    }
    if (replayed.score !== artifact.scoreTotal) {
      reasons.push(
        `deterministic replay scored ${String(replayed.score)}, artifact claims ${String(artifact.scoreTotal)}`,
      );
    }
    if (replayed.engine.currentTick !== artifact.finalTick) {
      reasons.push("deterministic replay ended on a different final tick");
    }
  } catch (error) {
    reasons.push(`deterministic replay failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let playerChecked = false;
  try {
    const rebuilt = replayFromPublicActions({
      scenario,
      seed: artifact.identity.seed,
      sessionId: artifact.identity.sessionId,
      actions: artifact.publicActionLedger ?? [],
    });
    playerChecked = true;
    const rebuiltPlayer = verifyPlayerEventStream([...rebuilt.playerEvents], {
      expectedSessionId: artifact.identity.sessionId,
      requireNonEmpty: true,
    });
    if (!rebuiltPlayer.validChain) {
      reasons.push(`rebuilt player stream invalid: ${rebuiltPlayer.reason ?? "unknown"}`);
    } else if (rebuiltPlayer.hash !== artifact.playerLogHash) {
      reasons.push(
        "player projection rebuild produced a different playerLogHash (truth/player semantic mismatch)",
      );
    }
    if (rebuilt.playerEvents.length !== artifact.playerEventCount) {
      reasons.push(
        `player projection rebuild produced ${rebuilt.playerEvents.length} events, artifact claims ${artifact.playerEventCount}`,
      );
    }
    if (rebuilt.engine.eventLogHash !== artifact.truthLogHash) {
      reasons.push("public-action replay produced a different truth log hash than the artifact");
    }
    const rebuiltTerminal = rebuilt.playerEvents[rebuilt.playerEvents.length - 1];
    const artifactTerminal = artifact.player.events[artifact.player.events.length - 1];
    if (
      rebuiltTerminal?.kind === "RunCompleted" &&
      artifactTerminal?.kind === "RunCompleted"
    ) {
      const rebuiltPayload = rebuiltTerminal.payload as { claimCount?: number; evidenceCount?: number };
      const artifactPayload = artifactTerminal.payload as { claimCount?: number; evidenceCount?: number };
      if (rebuiltPayload.claimCount !== artifactPayload.claimCount) {
        reasons.push("rebuilt RunCompleted.claimCount does not match artifact player terminal");
      }
      if (rebuiltPayload.evidenceCount !== artifactPayload.evidenceCount) {
        reasons.push("rebuilt RunCompleted.evidenceCount does not match artifact player terminal");
      }
    }
  } catch (error) {
    reasons.push(`player projection rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { truthChecked, playerChecked };
}

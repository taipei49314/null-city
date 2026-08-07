import type { CommandName, PlayerEventEnvelope } from "@null-city/contracts";
import { projectPlayerState } from "@null-city/epistemics";
import type { EngineSnapshotData, SimulationEngine } from "@null-city/simulation";

import { buildSessionArtifact } from "./artifact.js";
import { SessionHub, type SessionRecord } from "./hub.js";

export interface RpcSuccess {
  ok: true;
  result: unknown;
}

export interface RpcFailure {
  ok: false;
  error: { code: string; message: string };
}

export type RpcResult = RpcSuccess | RpcFailure;

export type RpcRequest = {
  op: string;
  params: Record<string, unknown>;
};

/**
 * Which authority the caller speaks with.
 *
 * `public` is everything reachable over REST/WebSocket. `admin` is reachable
 * only by an in-process host (the local CLI, tests, the demo script) that
 * already has the engine in its own address space. Audit finding P0-01: raw
 * `resume` used to be reachable from `POST /sessions`, which made a
 * caller-supplied world/score/PRNG/counter set authoritative. There is no
 * server-held key in v0.1, so the surface is removed instead of being
 * "validated harder".
 */
export type RpcSurface = "public" | "admin";

const ADMIN_ONLY_OPS = new Set(["admin.snapshot", "admin.resume"]);

export function okResult(result: unknown): RpcSuccess {
  return { ok: true, result };
}

export function failResult(code: string, message: string): RpcFailure {
  return { ok: false, error: { code, message } };
}

function asString(value: unknown, label: string, required = true): string | undefined {
  if (value === null || typeof value !== "string" || value.length === 0) {
    if (required) {
      throw new RpcError("invalid_params", `${label} must be a non-empty string`);
    }
    return undefined;
  }
  return value;
}

function asNumber(value: unknown, label: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new RpcError("invalid_params", `${label} must be a number`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RpcError("invalid_params", `${label} must be a number`);
  }
  return value;
}

export class RpcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function currentTruthSeq(engine: SimulationEngine): number {
  return engine.eventLog.length;
}

type SimulationSnapshot = EngineSnapshotData;

function publicState(record: SessionRecord) {
  return projectPlayerState(record.bridge.playerEvents);
}

/**
 * Player RPC surface. Never returns raw truth events or engine snapshots.
 */
export function handleRpc(
  hub: SessionHub,
  request: RpcRequest,
  surface: RpcSurface = "public",
): RpcResult {
  try {
    const { op } = request;
    if (surface !== "admin" && ADMIN_ONLY_OPS.has(op)) {
      return failResult("forbidden", `${op} is an in-process admin operation and is not exposed to players`);
    }
    switch (op) {
      case "session.create":
        return okResult(createSession(hub, request.params, surface));
      case "admin.resume":
        return okResult(adminResume(hub, request.params));
      case "session.state":
        return okResult(sessionState(hub, request.params));
      case "session.command":
        return okResult(sessionCommand(hub, request.params));
      case "session.advance":
        return okResult(sessionAdvance(hub, request.params));
      case "session.events":
        return okResult(sessionEvents(hub, request.params));
      case "session.assess":
        return okResult(sessionAssess(hub, request.params));
      case "session.summary":
        return okResult(sessionSummary(hub, request.params));
      case "session.artifact":
        return okResult(sessionArtifact(hub, request.params));
      case "session.snapshot":
        return failResult(
          "forbidden",
          "raw snapshots are not available on the player transport; use admin.snapshot in-process only",
        );
      case "admin.snapshot":
        return okResult(adminSnapshot(hub, request.params));
      case "session.list":
        return okResult({ sessions: hub.list() });
      case "session.delete":
        return okResult(deleteSession(hub, request.params));
      default:
        return failResult("unknown_op", `unknown operation ${JSON.stringify(op)}`);
    }
  } catch (error) {
    if (error instanceof RpcError) {
      return failResult(error.code, error.message);
    }
    return failResult("internal_error", error instanceof Error ? error.message : "internal error");
  }
}

/**
 * Creates a fresh session.
 *
 * `resume` is rejected outright on the public surface. A snapshot is a
 * complete authority transfer — world, score, resources, PRNG state, command
 * counters, idempotency keys — and nothing in a caller-supplied snapshot can
 * prove those values were produced by the embedded event chain. A digest
 * inside the snapshot does not help, because the attacker recomputes it. See
 * `docs/decisions/2026-08-07-authority-and-replay-semantics.md`.
 */
function createSession(hub: SessionHub, params: Record<string, unknown>, surface: RpcSurface): unknown {
  const scenarioId = asString(params["scenarioId"], "scenarioId")!;
  const rawResume = params["resume"];
  if (rawResume !== undefined && rawResume !== null) {
    if (surface !== "admin") {
      throw new RpcError(
        "forbidden",
        "resume from a caller-supplied snapshot is not available on the player transport; " +
          "snapshot resume is an in-process/admin operation (admin.resume)",
      );
    }
  }
  const resume = rawResume === undefined || rawResume === null ? undefined : (rawResume as SimulationSnapshot);
  const seed = Math.trunc(asNumber(params["seed"], "seed", resume ? (resume.seed as number) : 1));
  const sessionId =
    params["sessionId"] === undefined || params["sessionId"] === null
      ? hub.nextSessionId()
      : asString(params["sessionId"], "sessionId")!;

  let record: SessionRecord;
  try {
    record = resume
      ? hub.resume({ scenarioId, seed, sessionId, snapshot: resume })
      : hub.create({ scenarioId, seed, sessionId });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message.includes("already exists")) {
      throw new RpcError("conflict", error.message);
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RpcError("invalid_params", `unknown scenario ${JSON.stringify(scenarioId)}`);
    }
    // Bad caller input (rejected scenario name, unparseable or unbound
    // snapshot) is a 400, not an unexplained internal error.
    if (/mismatch|invalid scenario name|snapshot|scenario /i.test(error.message)) {
      throw new RpcError("invalid_params", error.message);
    }
    throw error;
  }
  const state = publicState(record);
  return {
    sessionId,
    seed: record.engine.seed,
    scenarioId: record.engine.scenario.id,
    tick: state.tick,
    playerLogHash: state.playerLogHash,
    state,
  };
}

function sessionState(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const record = requireSession(hub, sessionId);
  const state = publicState(record);
  return {
    sessionId,
    scenarioId: state.scenarioId,
    tick: state.tick,
    phase: state.phase,
    playerLogHash: state.playerLogHash,
    score: state.score.total,
    state,
  };
}

function sessionCommand(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const commandName = asString(params["commandName"], "commandName")! as CommandName;
  const rawParams =
    params["params"] === undefined || params["params"] === null
      ? {}
      : (params["params"] as Record<string, unknown>);
  if (typeof rawParams !== "object" || Array.isArray(rawParams)) {
    throw new RpcError("invalid_params", "params must be an object");
  }
  const idempotencyKey = asString(params["idempotencyKey"], "idempotencyKey")!;
  const record = requireSession(hub, sessionId);

  // A completed run is immutable on *every* layer, not just inside the engine.
  // The engine already refuses post-completion commands without emitting truth,
  // but the server used to keep going and append a `CommandResult` player
  // event, which moved `playerLogHash`, the player event count and therefore
  // the exported artifact hash after the terminal event. Answer here instead,
  // before the verification queue, the engine and the bridge are touched.
  if (record.engine.worldState.phase === "completed") {
    const rejected = record.engine.submitCommand(commandName, { ...rawParams }, idempotencyKey);
    return {
      sessionId,
      commandId: rejected.commandId,
      state: rejected.state,
      etaTick: rejected.etaTick,
      validation: rejected.validation,
      result: rejected.result,
      events: [],
      publicState: publicState(record),
    };
  }

  const engineParams = { ...rawParams };
  // Verification targeting is *not* recorded here. The inherited code wrote
  // `pendingClaimVerify` and called `bridge.targetClaim()` before the engine
  // had a chance to reject the command, so a rejected request left a stale
  // mapping that later resolved the claim off unrelated work (audit finding
  // P1-07). Everything is deferred until after acceptance.
  let verificationRequest: { teamId: string; claimId: string; target: string } | null = null;
  if (commandName === "REQUEST_VERIFICATION") {
    // Public contract (M10 P0-01): { teamId, claimId } only. A caller-provided
    // `target` must not compete with the claim's district, and district-only
    // requests are rejected so verification cannot silently bind to nothing.
    const claimId = typeof engineParams["claimId"] === "string" ? (engineParams["claimId"] as string) : undefined;
    const hasCallerTarget = typeof engineParams["target"] === "string" && (engineParams["target"] as string).length > 0;
    if (hasCallerTarget) {
      throw new RpcError(
        "invalid_params",
        "REQUEST_VERIFICATION must not include target; provide claimId only (server derives district)",
      );
    }
    if (!claimId) {
      throw new RpcError("invalid_params", "REQUEST_VERIFICATION requires claimId");
    }
    const state = publicState(record);
    const claim = state.claims.find((item) => item.id === claimId);
    if (!claim) {
      throw new RpcError("invalid_params", `unknown claimId ${claimId}`);
    }
    if (!claim.districtId) {
      throw new RpcError("invalid_params", `claim ${claimId} has no district`);
    }
    engineParams["target"] = claim.districtId;
    const teamId = asString(engineParams["teamId"], "teamId")!;
    verificationRequest = { teamId, claimId, target: claim.districtId };
    delete engineParams["claimId"];
  }

  // Record the public action with claim-targeted params (including server-resolved
  // district for REQUEST_VERIFICATION) so artifact v2 can rebuild the player log.
  const ledgerParams =
    verificationRequest !== null
      ? {
          teamId: verificationRequest.teamId,
          claimId: verificationRequest.claimId,
          target: verificationRequest.target,
        }
      : { ...rawParams };
  record.publicActionLedger.push({
    kind: "command",
    atTick: record.engine.currentTick,
    commandName,
    params: ledgerParams,
    idempotencyKey,
  });

  const before = currentTruthSeq(record.engine);
  const envelope = record.engine.submitCommand(commandName, engineParams, idempotencyKey);
  if (verificationRequest) {
    applyVerificationTargeting(record, verificationRequest, envelope.state === "accepted", envelope.commandId);
  }
  const playerEvents = hub.publishTruthDelta(record, before);
  const beforeCommandEvent = record.bridge.store.length;
  const commandEvent = record.bridge.notifyCommand({
    tick: record.engine.currentTick,
    commandId: envelope.commandId,
    commandName,
    idempotencyKey,
    state: envelope.state === "accepted" ? "accepted" : "rejected",
    errorCode: envelope.validation.errorCode,
    detail: envelope.result?.detail ?? envelope.validation.errorMessage,
    etaTick: envelope.etaTick,
    target: envelope.target,
  });
  hub.broadcast(sessionId, [commandEvent]);
  void beforeCommandEvent;

  return {
    sessionId,
    commandId: envelope.commandId,
    state: envelope.state,
    etaTick: envelope.etaTick,
    validation: envelope.validation,
    result: envelope.result,
    events: [...playerEvents, commandEvent],
    publicState: publicState(record),
  };
}

/**
 * Binds accepted verification work to the claim it was requested for, or
 * clears any prior binding when the command was rejected.
 */
function applyVerificationTargeting(
  record: SessionRecord,
  request: { teamId: string; claimId: string; target: string },
  accepted: boolean,
  commandId: string,
): void {
  const { teamId, claimId, target } = request;
  if (!accepted) {
    record.pendingClaimVerify.delete(teamId);
    record.bridge.clearClaimTarget(teamId);
    return;
  }
  const team = record.engine.worldState.teams.find((item) => item.teamId === teamId);
  const orderId = team?.order?.orderId;
  if (!orderId) {
    // Accepted without a live order is not a state this engine produces; do
    // not invent a binding that nothing can ever resolve.
    record.pendingClaimVerify.delete(teamId);
    record.bridge.clearClaimTarget(teamId);
    return;
  }
  record.pendingClaimVerify.set(teamId, { claimId, teamId, orderId, target, commandId });
  record.bridge.targetClaim(teamId, claimId);
}

/**
 * Advances the session and reports the number of ticks actually executed.
 *
 * `engine.step()` returns "is another tick possible", not "did a tick run":
 * the terminal tick executes, finalizes the run, and then returns `false`.
 * Counting loop iterations therefore under-reported the terminal advance by
 * one — a request for 540 ticks from tick 0 reached tick 540 but reported 539
 * (audit finding P1-08). The delta is now measured against the clock.
 */
function sessionAdvance(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const requested = Math.max(1, Math.min(540, Math.trunc(asNumber(params["ticks"], "ticks", 1))));
  const record = requireSession(hub, sessionId);
  const engine = record.engine;
  const tickBefore = engine.currentTick;
  // Publish player projection after every tick. Batching an entire advance into
  // one publishTruthDelta stamped every OwnTeamUpdated with the final tick and
  // reordered them relative to ScoreChanged/Evidence events (M10 player rebuild).
  const events: PlayerEventEnvelope[] = [];
  while (engine.currentTick - tickBefore < requested) {
    if (engine.worldState.phase === "completed") {
      break;
    }
    const before = currentTruthSeq(engine);
    const progressed = engine.step();
    events.push(...hub.publishTruthDelta(record, before));
    if (!progressed) {
      break;
    }
  }
  const advanced = engine.currentTick - tickBefore;
  return {
    sessionId,
    tick: engine.currentTick,
    advanced,
    completed: engine.worldState.phase === "completed",
    events,
    publicState: publicState(record),
  };
}

function sessionEvents(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const since = Math.max(0, Math.trunc(asNumber(params["since"], "since", 0)));
  const record = requireSession(hub, sessionId);
  const events: PlayerEventEnvelope[] = record.bridge.store.since(since);
  return {
    sessionId,
    since,
    next: record.bridge.store.length,
    stream: "player",
    events,
  };
}

function sessionAssess(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const claimId = asString(params["claimId"], "claimId")!;
  const probability = asNumber(params["probability"], "probability");
  const confidence = asNumber(params["confidence"], "confidence");
  const rationale =
    params["rationale"] === undefined || params["rationale"] === null
      ? undefined
      : asString(params["rationale"], "rationale", false);

  if (probability < 0 || probability > 1 || confidence < 0 || confidence > 1) {
    throw new RpcError("invalid_params", "probability and confidence must be in [0,1]");
  }

  const record = requireSession(hub, sessionId);
  if (record.engine.worldState.phase === "completed") {
    throw new RpcError("run_completed", "run is completed and immutable");
  }
  const state = publicState(record);
  if (!state.claims.some((claim) => claim.id === claimId)) {
    throw new RpcError("invalid_params", `unknown claimId ${claimId}`);
  }

  const assessment = {
    id: `assess-${record.bridge.store.length + 1}`,
    claimId,
    probability,
    confidence,
    ...(rationale ? { rationale } : {}),
    submittedTick: record.engine.currentTick,
  };
  record.publicActionLedger.push({
    kind: "assessment",
    atTick: record.engine.currentTick,
    id: assessment.id,
    claimId,
    probability,
    confidence,
    ...(rationale ? { rationale } : {}),
  });
  const event = record.bridge.notifyAssessment(record.engine.currentTick, assessment);
  hub.broadcast(sessionId, [event]);
  return {
    sessionId,
    assessment,
    events: [event],
    publicState: publicState(record),
  };
}

function sessionSummary(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const record = requireSession(hub, sessionId);
  const state = publicState(record);
  if (state.phase !== "completed") {
    throw new RpcError("not_completed", "session has not completed");
  }
  return {
    sessionId,
    scenarioId: state.scenarioId,
    finalTick: state.tick,
    scoreTotal: state.score.total,
    claimCount: state.claims.length,
    evidenceCount: state.evidence.length,
    assessmentCount: state.assessments.length,
    playerLogHash: state.playerLogHash,
    claims: state.claims,
  };
}

/**
 * Exports the completed run artifact for a session. Active sessions must
 * never get the truth bundle early: this rejects with `not_completed`
 * before the engine has reached `phase === "completed"`, on both REST and
 * WebSocket transports (both go through `handleRpc`).
 */
function sessionArtifact(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const record = requireSession(hub, sessionId);
  if (record.engine.worldState.phase !== "completed") {
    throw new RpcError("not_completed", "session has not completed; the run artifact is not available yet");
  }
  return buildSessionArtifact(record);
}

/**
 * Trusted, in-process resume. Reachable only through `handleAdminRpc`, i.e.
 * from a host that already owns the engine. The snapshot still has to satisfy
 * every binding check in `validateResumeBinding` (protocol, identity, scenario
 * digest, sequence/event-count agreement, embedded hash chain).
 *
 * Known limitation (audit finding P1-01): the resumed session's *player*
 * timeline is rebuilt by re-ingesting the truth log, so player-only history
 * (assessments, `CommandResult` events, pending verification targeting) is not
 * restored. `SessionHub.resume` reports this explicitly in
 * `playerHistoryRestored: false`.
 */
function adminResume(hub: SessionHub, params: Record<string, unknown>): unknown {
  const snapshot = params["snapshot"] ?? params["resume"];
  if (snapshot === undefined || snapshot === null) {
    throw new RpcError("invalid_params", "admin.resume requires a snapshot");
  }
  return createSession(hub, { ...params, resume: snapshot }, "admin");
}

function adminSnapshot(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const record = requireSession(hub, sessionId);
  return record.engine.snapshot();
}

function deleteSession(hub: SessionHub, params: Record<string, unknown>): unknown {
  const sessionId = asString(params["sessionId"], "sessionId")!;
  const removed = hub.delete(sessionId);
  if (!removed) {
    throw new RpcError("not_found", `session ${sessionId} does not exist`);
  }
  return { sessionId, deleted: true };
}

/**
 * In-process admin entry point. Deliberately not wired to any transport:
 * `attachHttp` and `attachWs` both call `handleRpc` with the default public
 * surface, so nothing reachable over the network can get here.
 */
export function handleAdminRpc(hub: SessionHub, request: RpcRequest): RpcResult {
  return handleRpc(hub, request, "admin");
}

function requireSession(hub: SessionHub, sessionId: string) {
  const record = hub.get(sessionId);
  if (!record) {
    throw new RpcError("not_found", `session ${sessionId} does not exist`);
  }
  return record;
}

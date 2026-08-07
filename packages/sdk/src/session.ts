import { randomUUID } from "node:crypto";
import type { PlayerEventEnvelope, PlayerSessionState } from "@null-city/contracts";

import { RestTransport } from "./rest.js";
import {
  advanceResultBodySchema,
  assessResultBodySchema,
  commandResultBodySchema,
  createSessionResultBodySchema,
  eventsResultBodySchema,
  sessionStateResultBodySchema,
  summaryResultBodySchema,
} from "./schemas.js";
import { ApiError } from "./errors.js";
import type {
  AdvanceOutcome,
  AssessmentOutcome,
  AssessmentRequest,
  CommandOutcome,
  CommandRequest,
  CreatePlayerSessionOptions,
  PlayerSession,
  RunSummary,
} from "./types.js";

/**
 * Creates (or, if `sessionId` already exists server-side, resumes access
 * to) a session and returns a `PlayerSession` bound to it. Every method
 * on the returned object talks exclusively to the public REST surface —
 * there is no in-process shortcut, even when the target server happens to
 * be running in the same Node process (as it is in the benchmark runner).
 */
export async function createPlayerSession(options: CreatePlayerSessionOptions): Promise<PlayerSession> {
  const transport = new RestTransport({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    retryBaseDelayMs: options.retryBaseDelayMs,
  });

  const created = await transport.call("POST", "/sessions", createSessionResultBodySchema, {
    body: {
      scenarioId: options.scenarioId,
      seed: options.seed,
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    },
    retryable: "never",
  });

  return new RestPlayerSession(transport, created.sessionId, created.scenarioId, created.seed);
}

class RestPlayerSession implements PlayerSession {
  readonly sessionId: string;
  readonly scenarioId: string;
  readonly seed: number;
  private closed = false;

  constructor(private readonly transport: RestTransport, sessionId: string, scenarioId: string, seed: number) {
    this.sessionId = sessionId;
    this.scenarioId = scenarioId;
    this.seed = seed;
  }

  async getState(): Promise<PlayerSessionState> {
    this.assertOpen();
    const body = await this.transport.call(
      "GET",
      `/sessions/${encodeURIComponent(this.sessionId)}/state`,
      sessionStateResultBodySchema,
      { retryable: "always" },
    );
    return body.state as unknown as PlayerSessionState;
  }

  async getEvents(afterSequence = 0): Promise<PlayerEventEnvelope[]> {
    this.assertOpen();
    const since = Math.max(0, Math.trunc(afterSequence));
    const body = await this.transport.call(
      "GET",
      `/sessions/${encodeURIComponent(this.sessionId)}/events?since=${since}`,
      eventsResultBodySchema,
      { retryable: "always" },
    );
    return body.events as unknown as PlayerEventEnvelope[];
  }

  async submitCommand(command: CommandRequest): Promise<CommandOutcome> {
    this.assertOpen();
    const idempotencyKey = command.idempotencyKey ?? randomUUID();
    const body = await this.transport.call(
      "POST",
      `/sessions/${encodeURIComponent(this.sessionId)}/command`,
      commandResultBodySchema,
      {
        body: { commandName: command.commandName, params: command.params, idempotencyKey },
        retryable: "idempotent-key",
      },
    );
    return {
      sessionId: body.sessionId,
      commandId: body.commandId,
      idempotencyKey,
      state: body.state,
      etaTick: body.etaTick,
      validation: body.validation,
      result: body.result,
      events: body.events as unknown as PlayerEventEnvelope[],
      publicState: body.publicState as unknown as PlayerSessionState,
      deduplicated: body.validation.errorCode === "duplicate_command",
    };
  }

  async submitAssessment(assessment: AssessmentRequest): Promise<AssessmentOutcome> {
    this.assertOpen();
    if (assessment.probability < 0 || assessment.probability > 1 || assessment.confidence < 0 || assessment.confidence > 1) {
      throw new ApiError("invalid_params", "probability and confidence must be in [0,1]");
    }
    const body = await this.transport.call(
      "POST",
      `/sessions/${encodeURIComponent(this.sessionId)}/assess`,
      assessResultBodySchema,
      {
        body: {
          claimId: assessment.claimId,
          probability: assessment.probability,
          confidence: assessment.confidence,
          ...(assessment.rationale === undefined ? {} : { rationale: assessment.rationale }),
        },
        // No server-side idempotency key exists for assessments; a blind
        // retry could record the same belief twice, so this call is never
        // auto-retried by the transport.
        retryable: "never",
      },
    );
    return {
      sessionId: body.sessionId,
      assessment: body.assessment,
      events: body.events as unknown as PlayerEventEnvelope[],
      publicState: body.publicState as unknown as PlayerSessionState,
    };
  }

  async advance(ticks: number): Promise<AdvanceOutcome> {
    this.assertOpen();
    const body = await this.transport.call(
      "POST",
      `/sessions/${encodeURIComponent(this.sessionId)}/advance`,
      advanceResultBodySchema,
      {
        body: { ticks },
        // Advancing has no idempotency key either; a lost response would
        // make a retry double-advance the clock, so it is never auto-retried.
        retryable: "never",
      },
    );
    return {
      sessionId: body.sessionId,
      tick: body.tick,
      advanced: body.advanced,
      completed: body.completed,
      events: body.events as unknown as PlayerEventEnvelope[],
      publicState: body.publicState as unknown as PlayerSessionState,
    };
  }

  async getCompletedRun(): Promise<RunSummary | null> {
    this.assertOpen();
    try {
      const body = await this.transport.call(
        "GET",
        `/sessions/${encodeURIComponent(this.sessionId)}/summary`,
        summaryResultBodySchema,
        { retryable: "always" },
      );
      return body as unknown as RunSummary;
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_completed") {
        return null;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ApiError("session_closed", `session ${this.sessionId} was closed`);
    }
  }
}

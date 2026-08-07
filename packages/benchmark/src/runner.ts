import { createServer, type NullCityServer } from "@null-city/server";
import {
  createPlayerSession,
  type AssessmentOutcome,
  type AssessmentRequest,
  type CommandOutcome,
  type CommandRequest,
  type PlayerSession,
} from "@null-city/sdk";
import { verifyPlayerEventStream, type PlayerEventEnvelope } from "@null-city/contracts";

import { computeMetrics, type BenchmarkMetrics } from "./metrics.js";
import type { Policy, PolicyDecision } from "./policy.js";

/** Hard ceiling so a runaway/misbehaving policy can never flood the transport. */
export const MAX_COMMANDS_PER_DECISION = 10;
export const MAX_ASSESSMENTS_PER_DECISION = 10;

export interface RunOptions {
  scenarioId: string;
  seed: number;
  policy: Policy;
  /** Ticks advanced per decision loop. Default 5. */
  tickStep?: number;
  /** Upper bound on total ticks, matching the server's own advance clamp. Default 540. */
  maxTicks?: number;
  /** Wall-clock budget per `policy.decide()` call. Default 250ms. */
  decisionTimeoutMs?: number;
  /** Wall-clock budget for the whole run, as a safety net. Default 60000ms. */
  runTimeoutMs?: number;
}

export interface RecordedCommand {
  tick: number;
  commandName: string;
  params: Record<string, unknown>;
  outcome: "accepted" | "rejected" | "pending" | "error";
  detail: string;
}

export interface RecordedAssessment {
  tick: number;
  claimId: string;
  probability: number;
  confidence: number;
  outcome: "accepted" | "error";
  detail: string;
}

export interface RecordedError {
  tick: number;
  phase: "decide" | "command" | "assessment" | "advance";
  message: string;
}

export interface RunRecord {
  scenarioId: string;
  seed: number;
  policyId: string;
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  finalTick: number;
  phase: "running" | "completed";
  commands: RecordedCommand[];
  assessments: RecordedAssessment[];
  errors: RecordedError[];
  boundedOutputTruncations: number;
  decisionTimeouts: number;
  playerEventCount: number;
  playerLogVerified: boolean;
  playerLogHash: string;
  metrics: BenchmarkMetrics;
}

/**
 * Runs exactly one (scenario, seed, policy) combination end to end. The
 * policy sees only `PlayerSessionState` via the SDK's public
 * `PlayerSession` — the same interface the browser and the MCP adapter
 * use, over a real HTTP loopback server, never an in-process shortcut.
 * Metrics are computed only after the player event log is independently
 * hash-chain-verified.
 */
export async function runOne(options: RunOptions): Promise<RunRecord> {
  const tickStep = options.tickStep ?? 5;
  const maxTicks = options.maxTicks ?? 540;
  const decisionTimeoutMs = options.decisionTimeoutMs ?? 250;
  const runTimeoutMs = options.runTimeoutMs ?? 60_000;
  const runDeadline = Date.now() + runTimeoutMs;

  const app: NullCityServer = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;

  const startedAt = new Date().toISOString();
  const commands: RecordedCommand[] = [];
  const assessments: RecordedAssessment[] = [];
  const errors: RecordedError[] = [];
  let boundedOutputTruncations = 0;
  let decisionTimeouts = 0;

  let session: PlayerSession | undefined;
  try {
    session = await createPlayerSession({
      baseUrl,
      scenarioId: options.scenarioId,
      seed: options.seed,
      sessionId: `bench-${options.scenarioId}-${options.seed}-${options.policy.id}`,
    });

    await options.policy.reset({ scenarioId: options.scenarioId, seed: options.seed, sessionId: session.sessionId });

    let completed = false;
    while (!completed) {
      if (Date.now() > runDeadline) {
        errors.push({ tick: -1, phase: "advance", message: `run exceeded runTimeoutMs=${runTimeoutMs}` });
        break;
      }

      const state = await session.getState();
      let decision: PolicyDecision;
      try {
        decision = await withTimeout(options.policy.decide({ state }), decisionTimeoutMs, "policy.decide");
      } catch (error) {
        decisionTimeouts += error instanceof TimeoutError ? 1 : 0;
        errors.push({ tick: state.tick, phase: "decide", message: describeError(error) });
        decision = { commands: [], assessments: [] };
      }

      const boundedCommands: CommandRequest[] = decision.commands.slice(0, MAX_COMMANDS_PER_DECISION);
      if (decision.commands.length > boundedCommands.length) {
        boundedOutputTruncations += 1;
      }
      const boundedAssessments: AssessmentRequest[] = decision.assessments.slice(0, MAX_ASSESSMENTS_PER_DECISION);
      if (decision.assessments.length > boundedAssessments.length) {
        boundedOutputTruncations += 1;
      }

      for (const command of boundedCommands) {
        try {
          const outcome: CommandOutcome = await session.submitCommand(command);
          commands.push({
            tick: state.tick,
            commandName: command.commandName,
            params: command.params,
            outcome: outcome.state,
            detail: outcome.result?.detail ?? outcome.validation.errorMessage ?? "",
          });
        } catch (error) {
          errors.push({ tick: state.tick, phase: "command", message: describeError(error) });
          commands.push({ tick: state.tick, commandName: command.commandName, params: command.params, outcome: "error", detail: describeError(error) });
        }
      }

      for (const assessment of boundedAssessments) {
        try {
          const outcome: AssessmentOutcome = await session.submitAssessment(assessment);
          assessments.push({
            tick: state.tick,
            claimId: assessment.claimId,
            probability: assessment.probability,
            confidence: assessment.confidence,
            outcome: "accepted",
            detail: outcome.assessment.id,
          });
        } catch (error) {
          errors.push({ tick: state.tick, phase: "assessment", message: describeError(error) });
          assessments.push({
            tick: state.tick,
            claimId: assessment.claimId,
            probability: assessment.probability,
            confidence: assessment.confidence,
            outcome: "error",
            detail: describeError(error),
          });
        }
      }

      try {
        const advanced = await session.advance(Math.min(tickStep, maxTicks));
        completed = advanced.completed;
      } catch (error) {
        errors.push({ tick: state.tick, phase: "advance", message: describeError(error) });
        break;
      }
    }

    await options.policy.close?.();

    const events: readonly PlayerEventEnvelope[] = await session.getEvents(0);
    const verification = verifyPlayerEventStream(events as PlayerEventEnvelope[], {
      expectedSessionId: session.sessionId,
      requireNonEmpty: true,
    });
    const metrics = computeMetrics(events);
    const finalSummary = await session.getCompletedRun();

    return {
      scenarioId: options.scenarioId,
      seed: options.seed,
      policyId: options.policy.id,
      sessionId: session.sessionId,
      startedAt,
      finishedAt: new Date().toISOString(),
      finalTick: metrics.finalTick,
      phase: finalSummary ? "completed" : metrics.phase,
      commands,
      assessments,
      errors,
      boundedOutputTruncations,
      decisionTimeouts,
      playerEventCount: events.length,
      playerLogVerified: verification.validChain,
      playerLogHash: verification.hash,
      metrics,
    };
  } finally {
    await session?.close();
    await app.close();
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

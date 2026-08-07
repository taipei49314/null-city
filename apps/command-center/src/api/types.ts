import type { Assessment, CommandName, PlayerEventEnvelope, PlayerSessionState } from "@null-city/contracts";

export interface ApiErrorBody {
  code: string;
  message: string;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}

export interface CreateSessionResult {
  sessionId: string;
  seed: number;
  scenarioId: string;
  tick: number;
  playerLogHash: string;
  state: PlayerSessionState;
}

export interface SessionStateResult {
  sessionId: string;
  scenarioId: string;
  tick: number;
  phase: "running" | "completed";
  playerLogHash: string;
  score: number;
  state: PlayerSessionState;
}

export interface CommandValidation {
  valid: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CommandResult {
  sessionId: string;
  commandId: string;
  state: "accepted" | "rejected" | "pending";
  etaTick: number | null;
  validation: CommandValidation;
  result: { ok: boolean; detail: string } | null;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
}

export interface AdvanceResult {
  sessionId: string;
  tick: number;
  advanced: number;
  completed: boolean;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
}

export interface AssessResult {
  sessionId: string;
  assessment: Assessment;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
}

export interface SummaryResult {
  sessionId: string;
  scenarioId: string;
  finalTick: number;
  scoreTotal: number;
  claimCount: number;
  evidenceCount: number;
  assessmentCount: number;
  playerLogHash: string;
  claims: PlayerSessionState["claims"];
}

export interface EventsResult {
  sessionId: string;
  since: number;
  next: number;
  stream: "player";
  events: PlayerEventEnvelope[];
}

export interface CommandRequest {
  commandName: CommandName;
  params: Record<string, unknown>;
  idempotencyKey: string;
}

import type {
  Assessment,
  Claim,
  CommandName,
  PlayerEventEnvelope,
  PlayerSessionState,
} from "@null-city/contracts";

/**
 * The exact same interface the browser (Command Center), the benchmark
 * runner, and the MCP adapter are all built on. No method here ever
 * returns truth: every field flows from `PlayerSessionState`/player
 * events, the same public contract `packages/server/src/rpc.ts` exposes
 * over REST/WS. There is no `getSnapshot`, `getTruth`, or admin method.
 */
export interface PlayerSession {
  readonly sessionId: string;
  readonly scenarioId: string;
  readonly seed: number;

  /** Current player-visible state, rebuilt server-side from player events alone. */
  getState(): Promise<PlayerSessionState>;

  /** Player events strictly after `afterSequence` (default 0 = from genesis). */
  getEvents(afterSequence?: number): Promise<PlayerEventEnvelope[]>;

  /**
   * Submits a command. If `idempotencyKey` is omitted, the SDK generates
   * one and reuses it across any internal retry, so a network failure can
   * never cause the same command to execute twice.
   */
  submitCommand(command: CommandRequest): Promise<CommandOutcome>;

  /** Submits a probability/confidence assessment against an existing claim. */
  submitAssessment(assessment: AssessmentRequest): Promise<AssessmentOutcome>;

  /**
   * Advances the deterministic clock by up to `ticks` (server-clamped to
   * [1, 540]). This is the same call every client — human or agent — uses
   * to move time forward; the kernel never advances on a wall-clock timer.
   */
  advance(ticks: number): Promise<AdvanceOutcome>;

  /** Completed-run summary, or `null` while the run is still active. */
  getCompletedRun(): Promise<RunSummary | null>;

  /** Releases any held resources (WS subscription, if one was opened). Safe to call more than once. */
  close(): Promise<void>;
}

export interface CommandRequest {
  commandName: CommandName;
  params: Record<string, unknown>;
  /** Auto-generated (`crypto.randomUUID()`) when omitted. */
  idempotencyKey?: string;
}

export interface AssessmentRequest {
  claimId: string;
  probability: number;
  confidence: number;
  rationale?: string;
}

export interface CommandValidationResult {
  valid: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CommandOutcome {
  sessionId: string;
  commandId: string;
  idempotencyKey: string;
  state: "accepted" | "rejected" | "pending";
  etaTick: number | null;
  validation: CommandValidationResult;
  result: { ok: boolean; detail: string } | null;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
  /**
   * `true` only when this outcome was recovered from a transport-level
   * retry that hit the engine's `duplicate_command` rejection — i.e. an
   * earlier attempt already executed the command and this response is a
   * safe, no-op echo, not a fresh rejection.
   */
  deduplicated: boolean;
}

export interface AssessmentOutcome {
  sessionId: string;
  assessment: Assessment;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
}

export interface AdvanceOutcome {
  sessionId: string;
  tick: number;
  advanced: number;
  completed: boolean;
  events: PlayerEventEnvelope[];
  publicState: PlayerSessionState;
}

export interface RunSummary {
  sessionId: string;
  scenarioId: string;
  finalTick: number;
  scoreTotal: number;
  claimCount: number;
  evidenceCount: number;
  assessmentCount: number;
  playerLogHash: string;
  claims: Claim[];
}

export interface CreatePlayerSessionOptions {
  /** e.g. `http://127.0.0.1:8787` — no trailing slash. */
  baseUrl: string;
  scenarioId: string;
  seed: number;
  /** Server generates one when omitted. */
  sessionId?: string;
  /** Defaults to global `fetch`. Overridable for tests. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout before treating the call as a network error. Default 15000. */
  timeoutMs?: number;
  /** Extra attempts after the first for retryable failures. Default 2. */
  maxRetries?: number;
  /** Base backoff delay in ms (exponential + jitter). Default 100. */
  retryBaseDelayMs?: number;
}

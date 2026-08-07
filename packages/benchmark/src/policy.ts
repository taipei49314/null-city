import type { AssessmentRequest, CommandRequest } from "@null-city/sdk";
import type { PlayerSessionState } from "@null-city/contracts";

/** A policy never sees anything beyond `PlayerSessionState` — no truth, ever. */
export interface PolicyContext {
  scenarioId: string;
  seed: number;
  sessionId: string;
}

export interface PolicyInput {
  state: PlayerSessionState;
}

export interface PolicyDecision {
  commands: CommandRequest[];
  assessments: AssessmentRequest[];
}

export const emptyDecision: PolicyDecision = { commands: [], assessments: [] };

/**
 * The same shape `01_TARGET_ARCHITECTURE.md` specifies for a policy. All
 * three baselines below are deterministic functions of `PlayerSessionState`
 * — no randomness, no wall clock, no LLM, no truth.
 */
export interface Policy {
  readonly id: string;
  reset(context: PolicyContext): Promise<void>;
  decide(input: PolicyInput): Promise<PolicyDecision>;
  close?(): Promise<void>;
}

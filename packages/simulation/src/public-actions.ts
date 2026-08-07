/**
 * Canonical public-action ledger (artifact v2).
 *
 * Truth alone cannot reconstruct assessments or claim-targeted verification
 * intent (`claimId` is stripped before the engine). These player-originated
 * actions are the independent inputs used to rebuild the player projection.
 */

export type PublicCommandAction = {
  kind: "command";
  atTick: number;
  commandName: string;
  params: Record<string, unknown>;
  idempotencyKey: string;
};

export type PublicAssessmentAction = {
  kind: "assessment";
  atTick: number;
  id: string;
  claimId: string;
  probability: number;
  confidence: number;
  rationale?: string;
};

export type PublicAction = PublicCommandAction | PublicAssessmentAction;

export function isPublicCommandAction(action: PublicAction): action is PublicCommandAction {
  return action.kind === "command";
}

export function isPublicAssessmentAction(action: PublicAction): action is PublicAssessmentAction {
  return action.kind === "assessment";
}

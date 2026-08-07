import type { DistrictId, RouteId, TeamId } from "./ids.js";
import type { Tick } from "./types.js";

/** Public claim lifecycle for the epistemic projection. */
export type ClaimStatus =
  | "reported"
  | "corroborated"
  | "contested"
  | "verified"
  | "refuted"
  | "stale";

export interface Evidence {
  id: string;
  claimId: string;
  sourceId: string;
  observedTick: Tick;
  deliveredTick: Tick;
  content: string;
  category: string;
  reliability: number;
  /** True when a later public verification established consistency. */
  verified: boolean;
}

export interface Claim {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  districtId?: DistrictId;
  incidentHint?: string;
  firstObservedTick: Tick;
  lastUpdatedTick: Tick;
  status: ClaimStatus;
  evidenceIds: string[];
  asOfTick: Tick;
}

export interface Assessment {
  id: string;
  claimId: string;
  probability: number;
  confidence: number;
  rationale?: string;
  submittedTick: Tick;
}

export interface OwnTeamState {
  teamId: TeamId;
  type: string;
  location: DistrictId;
  status: string;
  etaTick: Tick | null;
  orderTarget: DistrictId | null;
  orderTask: string | null;
}

export interface KnownRouteState {
  id: RouteId;
  closed: boolean;
  /** Only set when the player closed/reopened it or was told via public action. */
  knownClosedAtTick: Tick | null;
}

export interface PublicResources {
  backupGenerators: number;
  advisoryUses: number;
}

export interface PublicScore {
  total: number;
  recent: Array<{ category: string; delta: number; reason: string; tick: Tick }>;
}

export interface PlayerSessionState {
  stream: "player";
  sessionId: string;
  scenarioId: string;
  tick: Tick;
  phase: "running" | "completed";
  claims: Claim[];
  evidence: Evidence[];
  assessments: Assessment[];
  teams: OwnTeamState[];
  routes: KnownRouteState[];
  resources: PublicResources;
  score: PublicScore;
  playerEventCount: number;
  playerLogHash: string;
}

export type PlayerEventKind =
  | "SessionStarted"
  | "EvidenceRecorded"
  | "ClaimUpdated"
  | "AssessmentSubmitted"
  | "VerificationResolved"
  | "CommandResult"
  | "OwnTeamUpdated"
  | "KnownRouteUpdated"
  | "PublicScoreChanged"
  | "ResourcesChanged"
  | "RunCompleted";

export interface PlayerEventEnvelope<T = unknown> {
  stream: "player";
  sessionId: string;
  sequence: number;
  tick: Tick;
  kind: PlayerEventKind;
  payload: T;
  previousHash: string;
  hash: string;
}

export interface SessionStartedPayload {
  scenarioId: string;
  seed: number;
  totalTicks: Tick;
  teams: OwnTeamState[];
  routes: KnownRouteState[];
  resources: PublicResources;
}

export interface EvidenceRecordedPayload {
  evidence: Evidence;
}

export interface ClaimUpdatedPayload {
  claim: Claim;
  reason: "reported" | "corroborated" | "contested" | "verified" | "refuted" | "stale" | "updated";
}

export interface AssessmentSubmittedPayload {
  assessment: Assessment;
}

export interface VerificationResolvedPayload {
  claimId: string;
  teamId: TeamId;
  outcome: "verified" | "refuted" | "inconclusive";
  resolvedTick: Tick;
}

export interface CommandResultPayload {
  commandId: string;
  commandName: string;
  idempotencyKey: string;
  state: "accepted" | "rejected";
  errorCode: string | null;
  detail: string | null;
  etaTick: Tick | null;
  target: string;
}

export interface OwnTeamUpdatedPayload {
  team: OwnTeamState;
}

export interface KnownRouteUpdatedPayload {
  route: KnownRouteState;
}

export interface PublicScoreChangedPayload {
  delta: number;
  reason: string;
  category: string;
  total: number;
}

export interface ResourcesChangedPayload {
  resources: PublicResources;
}

export interface RunCompletedPayload {
  finalTick: Tick;
  scoreTotal: number;
  claimCount: number;
  evidenceCount: number;
}

export type PlayerEventPayload =
  | SessionStartedPayload
  | EvidenceRecordedPayload
  | ClaimUpdatedPayload
  | AssessmentSubmittedPayload
  | VerificationResolvedPayload
  | CommandResultPayload
  | OwnTeamUpdatedPayload
  | KnownRouteUpdatedPayload
  | PublicScoreChangedPayload
  | ResourcesChangedPayload
  | RunCompletedPayload;

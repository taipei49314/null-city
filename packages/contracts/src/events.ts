import type { DistrictId, TeamId } from "./ids.js";
import type { Tick } from "./types.js";
import type { DistrictState, ScoreState, TeamOrderRef } from "./truth-state.js";

export type EventId = string;

/**
 * Every state change in the simulation is an event.
 * Events form a hash chain: hash = SHA256(canonical(previousHash, sequence, tick, kind, payload)).
 */
export interface EventEnvelope<T = unknown> {
  sessionId: string;
  sequence: number;
  tick: Tick;
  kind: EventKindName;
  payload: T;
  previousHash: string;
  hash: string;
}

export type EventKindName =
  | "ScenarioStarted"
  | "TrueIncidentOccurred"
  | "IncidentChained"
  | "IncidentResolved"
  | "ObservationCreated"
  | "ObservationDelayed"
  | "ObservationCorrupted"
  | "ObservationLost"
  | "ObservationDelivered"
  | "CommandIssued"
  | "CommandRejected"
  | "CommandAccepted"
  | "TeamDispatched"
  | "TeamArrived"
  | "ActionApplied"
  | "SystemStateChanged"
  | "ScoreChanged"
  | "ScenarioCompleted";

export const EVENT_KINDS = [
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
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ScenarioStartedPayload {
  scenarioId: string;
  seed: number;
  tickPerSimSecond: number;
  totalTicks: Tick;
  districts: DistrictId[];
}

export interface TrueIncidentOccurredPayload {
  incidentId: string;
  kind: string;
  district: DistrictId;
  severity: number;
}

export interface IncidentChainedPayload {
  incidentId: string;
  sourceIncidentId: string;
  district: DistrictId;
  severity: number;
}

export interface IncidentResolvedPayload {
  incidentId: string;
  district: DistrictId;
  handledTick: Tick;
}

export interface ObservationCreatedPayload {
  observationId: string;
  incidentId: string;
  source: string;
  observedTick: Tick;
  content: string;
  reliability: number;
  /** category used by the scenario to express the observation */
  category: string;
}

export interface ObservationDelayedPayload {
  observationId: string;
  newDeliveryTick: Tick;
  delayTicks: number;
}

export interface ObservationCorruptedPayload {
  observationId: string;
  corruptionType:
    | "exaggerated"
    | "understated"
    | "mistaken_identity"
    | "wrong_location"
    | "attribution_error";
  original: string;
  corrupted: string;
  false: boolean;
}

export interface ObservationLostPayload {
  observationId: string;
  reason: "transmission_lost" | "outdated_by_timeout";
}

export interface ObservationDeliveredPayload {
  observationId: string;
  deliveredTick: Tick;
}

export interface CommandIssuedPayload {
  commandId: string;
  commandName: string;
  idempotencyKey: string;
  issuedTick: Tick;
  target: string | null;
  params: Record<string, unknown>;
}

export interface CommandRejectedPayload {
  commandId: string;
  reason: string;
  code: string;
}

export interface CommandAcceptedPayload {
  commandId: string;
  idempotencyKey: string;
  etaTick: Tick | null;
}

export interface TeamDispatchedPayload {
  teamId: TeamId;
  orderId: string;
  from: DistrictId;
  to: DistrictId;
  travelTicks: number;
  etaTick: Tick;
}

export interface TeamArrivedPayload {
  teamId: TeamId;
  orderId: string;
  district: DistrictId;
}

export interface ActionAppliedPayload {
  action: string;
  target: DistrictId;
  attribute: string;
  delta: number;
  result: number;
}

export interface SystemStateChangedPayload {
  districts: Record<DistrictId, DistrictState>;
  teams: Array<{
    teamId: TeamId;
    status: string;
    location: DistrictId;
    etaTick: Tick | null;
    order: TeamOrderRef | null;
  }>;
  routes: Record<string, { closed: boolean }>;
  resources: { backupGenerators: number; advisoryUses: number };
}

export interface ScoreChangedPayload {
  delta: number;
  reason: string;
  category: string;
  total: number;
}

export interface ScenarioCompletedPayload {
  finalScore: ScoreState;
  finalTick: Tick;
}

export type EventPayload =
  | ScenarioStartedPayload
  | TrueIncidentOccurredPayload
  | IncidentChainedPayload
  | IncidentResolvedPayload
  | ObservationCreatedPayload
  | ObservationDelayedPayload
  | ObservationCorruptedPayload
  | ObservationLostPayload
  | ObservationDeliveredPayload
  | CommandIssuedPayload
  | CommandRejectedPayload
  | CommandAcceptedPayload
  | TeamDispatchedPayload
  | TeamArrivedPayload
  | ActionAppliedPayload
  | SystemStateChangedPayload
  | ScoreChangedPayload
  | ScenarioCompletedPayload;

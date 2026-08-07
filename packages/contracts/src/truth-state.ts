/**
 * Truth-only world state.
 *
 * These types describe the authoritative simulation world that a player must
 * never observe. They are reachable only through the `@null-city/contracts/truth`
 * subpath; the package's main entry point (`@null-city/contracts`) exports the
 * public/player contract and nothing from this file. See
 * `docs/decisions/2026-08-07-authority-and-replay-semantics.md`.
 */

import type { DistrictId, RouteId } from "./ids.js";
import type { TeamType, Tick } from "./types.js";

/** Authoritative per-district state. Players only ever see derived claims. */
export interface DistrictState {
  id: DistrictId;
  /** 0..100 availability */
  power: number;
  communications: number;
  water: number;
  traffic: number;
  medicalCapacity: number;
  /** 0..100 */
  hazardLevel: number;
  /** 0..100 */
  populationRisk: number;
}

export type TruthState = Record<DistrictId, DistrictState>;

export interface RoadLink {
  id: RouteId;
  from: DistrictId;
  to: DistrictId;
  /** base travel ticks for teams */
  travelTicks: number;
  /** 0..100, drops when the road is closed or the district is blocked */
  capacity: number;
  closed: boolean;
}

export type TeamStatus = "idle" | "transit" | "working";

export interface TeamOrderRef {
  orderId: string;
  /** "original" when the team executes the first order, "rerouted" after CANCEL_ORDER */
  origin: "original" | "rerouted";
  target: DistrictId;
  task: string;
}

export interface TeamState {
  teamId: string;
  type: TeamType;
  location: DistrictId;
  status: TeamStatus;
  /** tick the current movement completes; null when not moving */
  etaTick: Tick | null;
  order: TeamOrderRef | null;
  /** true when the team can be re-dispatched while working */
  reschedulable: boolean;
  /** extra ticks consumed by cancelled / re-routed orders */
  wastedTicks: number;
}

export interface ResourceState {
  /** remaining backup generator activations */
  backupGenerators: number;
  /** total backup generator activations available in the scenario */
  backupGeneratorsTotal: number;
  /** number of public advisories already broadcast */
  advisoryUses: number;
  advisoryUsesTotal: number;
  /** current cost pool from wrongly issued public advisories */
  misadvisoryCost: number;
}

export interface RouteState {
  id: RouteId;
  closed: boolean;
  /**
   * Tick of the *current* closure. Cleared to null when the route reopens, so
   * this is never stale metadata describing a closure that no longer applies.
   * Closure history lives in `closureHistory`.
   */
  closedAtTick: Tick | null;
  /** Actor of the *current* closure; cleared on reopen. */
  closedBy: string | null;
  /** Append-only closure history, newest last. */
  closureHistory: RouteClosureRecord[];
}

export interface RouteClosureRecord {
  closedAtTick: Tick;
  closedBy: string;
  /** null while the closure is still in effect */
  reopenedAtTick: Tick | null;
  reopenedBy: string | null;
}

export interface GlobalState {
  tick: Tick;
  phase: "running" | "completed";
  districts: TruthState;
  teams: TeamState[];
  routes: Record<RouteId, RouteState>;
  resources: ResourceState;
  /** pending supply-line effects; consumed each tick */
  effects: EffectPayload[];
  score: ScoreState;
  /** internal bookkeeping used by the deterministic engine */
  internal: InternalState;
}

/**
 * Derived, explainable scoring — never a single opaque number.
 *
 * Fields are split into `raw` (measured quantities in their natural units)
 * and weighted score components (points contributed to `total`). See
 * `docs/scoring.md`.
 */
export interface ScoreState {
  total: number;
  finalPopulationRisk: number;
  infrastructureAvailability: number;
  /** points contributed by resolved incidents */
  eventsHandledPoints: number;
  /** points (negative) contributed by unresolved incidents at completion */
  eventsMissedPoints: number;
  misadvisoryCost: number;
  wastedDispatchCost: number;
  /** points (negative) contributed by late first effective action */
  decisionDelayPoints: number;
  resourceEfficiency: number;
  chainFailurePenalty: number;
  /** unweighted measurements, in their natural units */
  raw: ScoreRawMetrics;
  breakdown: ScoreBreakdownItem[];
}

/** Unweighted measurements. Counts are counts; ticks are ticks. */
export interface ScoreRawMetrics {
  /** number of incidents resolved during the run */
  incidentsHandled: number;
  /** number of incidents still active at completion */
  incidentsMissed: number;
  /** number of chained failures that occurred */
  chainedIncidents: number;
  /** travel ticks discarded by cancel/re-route */
  wastedDispatchTicks: number;
  /** summed ticks between incident start and first effective action */
  decisionDelayTicks: number;
  /** incidents that never received an effective action */
  incidentsWithoutAction: number;
  /** remaining backup generator activations */
  remainingBackupGenerators: number;
  /** remaining public advisory uses */
  remainingAdvisories: number;
}

export interface ScoreBreakdownItem {
  id: string;
  label: string;
  delta: number;
  tick: Tick;
  reason: string;
}

export interface EffectPayload {
  id: string;
  kind: string;
  target: DistrictId;
  /** power/communications/water/traffic/medicalCapacity/hazardLevel/populationRisk */
  attribute: keyof DistrictState;
  delta: number;
  /** source event sequence number; null for scenario-scheduled effects */
  sourceEvent: number | null;
  dueTick: Tick;
}

export interface InternalState {
  /** active incidents keyed by incident id */
  incidents: Record<string, IncidentState>;
  /** active scheduled scenario effects */
  scheduled: ScheduledEffectState[];
  /** verification requests in flight */
  verifications: VerificationState[];
  /** backup generator active per district */
  backupActive: Partial<Record<DistrictId, number>>;
  /** power reroute: which district takes the load of which district */
  powerReroute: Record<string, string>;
  /** communication priority windows */
  commPriority: Array<{ district: DistrictId; untilTick: Tick }>;
  /** records observation channel config overrides */
  channelDegradation: number;
  /** count of lost observation events for reporting */
  lostObservationCount: number;
  /** observation defs waiting for their creation tick */
  pendingObservationDefs: Array<{ atTick: Tick; defId: string }>;
  /** scenario-local random-access work queue for events that
   *  cannot be computed as a pure function of the event stream */
  workQueue: WorkItem[];
}

export interface WorkItem {
  id: string;
  kind: string;
  tick: Tick;
  payload: Record<string, unknown>;
}

export interface IncidentState {
  id: string;
  kind: string;
  district: DistrictId;
  severity: number;
  active: boolean;
  startTick: Tick;
  handledTick: Tick | null;
  /** true when the incident was triggered by a chained failure instead of the scenario script */
  chained: boolean;
}

export interface ScheduledEffectState {
  id: string;
  dueTick: Tick;
  effect: EffectPayload;
  repeatEvery: number | null;
}

export interface VerificationState {
  id: string;
  orderId: string;
  teamId: string;
  target: DistrictId;
  startTick: Tick;
  untilTick: Tick;
}

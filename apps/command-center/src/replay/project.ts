/**
 * Pure, clean-room reducers over a validated `ReplayArtifact`.
 *
 * Player-state projection mirrors `packages/epistemics/src/project.ts`'s
 * `applyPlayerEvent` (reimplemented locally so this module has zero runtime
 * dependency on `@null-city/epistemics`, which itself imports truth types).
 * Truth-state projection has no equivalent elsewhere: it only exists here,
 * scoped to Replay Lab, and only ever runs against an artifact whose phase
 * is already `completed`.
 */
import type {
  Assessment,
  Claim,
  Evidence,
  KnownRouteState,
  OwnTeamState,
  PlayerEventEnvelope,
  PublicResources,
} from "@null-city/contracts";
import type { ReplayArtifact, ReplayCommandTraceEntry, ReplayTruthEvent } from "./schema";

export interface PlayerProjection {
  tick: number;
  phase: "running" | "completed";
  claims: Claim[];
  evidence: Evidence[];
  assessments: Assessment[];
  teams: OwnTeamState[];
  routes: KnownRouteState[];
  resources: PublicResources;
  score: { total: number; recent: Array<{ category: string; delta: number; reason: string; tick: number }> };
}

function emptyPlayerProjection(): PlayerProjection {
  return {
    tick: 0,
    phase: "running",
    claims: [],
    evidence: [],
    assessments: [],
    teams: [],
    routes: [],
    resources: { backupGenerators: 0, advisoryUses: 0 },
    score: { total: 0, recent: [] },
  };
}

/** Rebuilds public session state from player events alone, up to and including `atTick`. */
export function projectPlayerAtTick(events: readonly PlayerEventEnvelope[], atTick: number): PlayerProjection {
  let state = emptyPlayerProjection();
  for (const event of events) {
    if (event.tick > atTick) {
      break;
    }
    state = applyPlayerEvent(state, event);
  }
  return state;
}

function applyPlayerEvent(state: PlayerProjection, event: PlayerEventEnvelope): PlayerProjection {
  const next: PlayerProjection = {
    ...state,
    tick: event.tick,
    claims: [...state.claims],
    evidence: [...state.evidence],
    assessments: [...state.assessments],
    teams: [...state.teams],
    routes: [...state.routes],
    resources: { ...state.resources },
    score: { total: state.score.total, recent: [...state.score.recent] },
  };

  switch (event.kind) {
    case "SessionStarted": {
      const payload = event.payload as { teams: OwnTeamState[]; routes: KnownRouteState[]; resources: PublicResources };
      next.teams = payload.teams.map((t) => ({ ...t }));
      next.routes = payload.routes.map((r) => ({ ...r }));
      next.resources = { ...payload.resources };
      break;
    }
    case "EvidenceRecorded": {
      const evidence = (event.payload as { evidence: Evidence }).evidence;
      next.evidence = [...next.evidence.filter((item) => item.id !== evidence.id), { ...evidence }];
      break;
    }
    case "ClaimUpdated": {
      const claim = (event.payload as { claim: Claim }).claim;
      next.claims = [...next.claims.filter((item) => item.id !== claim.id), { ...claim }];
      break;
    }
    case "AssessmentSubmitted": {
      const assessment = (event.payload as { assessment: Assessment }).assessment;
      next.assessments = [...next.assessments.filter((item) => item.id !== assessment.id), { ...assessment }];
      break;
    }
    case "VerificationResolved": {
      const payload = event.payload as { claimId: string; outcome: "verified" | "refuted" | "inconclusive" };
      next.claims = next.claims.map((claim) =>
        claim.id !== payload.claimId
          ? claim
          : payload.outcome === "inconclusive"
            ? { ...claim, lastUpdatedTick: event.tick, asOfTick: event.tick }
            : { ...claim, status: payload.outcome, lastUpdatedTick: event.tick, asOfTick: event.tick },
      );
      break;
    }
    case "OwnTeamUpdated": {
      const team = (event.payload as { team: OwnTeamState }).team;
      next.teams = [...next.teams.filter((item) => item.teamId !== team.teamId), { ...team }];
      break;
    }
    case "KnownRouteUpdated": {
      const route = (event.payload as { route: KnownRouteState }).route;
      next.routes = [...next.routes.filter((item) => item.id !== route.id), { ...route }];
      break;
    }
    case "PublicScoreChanged": {
      const payload = event.payload as { delta: number; reason: string; category: string; total: number };
      next.score.total = payload.total;
      next.score.recent = [...next.score.recent, { category: payload.category, delta: payload.delta, reason: payload.reason, tick: event.tick }];
      break;
    }
    case "ResourcesChanged": {
      next.resources = { ...(event.payload as { resources: PublicResources }).resources };
      break;
    }
    case "RunCompleted": {
      next.phase = "completed";
      next.tick = (event.payload as { finalTick: number }).finalTick;
      next.score.total = (event.payload as { scoreTotal: number }).scoreTotal;
      break;
    }
    default:
      break;
  }
  return next;
}

export interface TruthDistrictState {
  id: string;
  power: number;
  communications: number;
  water: number;
  traffic: number;
  medicalCapacity: number;
  hazardLevel: number;
  populationRisk: number;
}

export interface TruthTeamState {
  teamId: string;
  status: string;
  location: string;
  etaTick: number | null;
  order: unknown;
}

export interface TruthIncident {
  id: string;
  kind: string;
  district: string;
  severity: number;
  active: boolean;
  chainedFromIncidentId: string | null;
  occurredTick: number;
  resolvedTick: number | null;
}

export interface TruthProjection {
  tick: number;
  districts: TruthDistrictState[];
  teams: TruthTeamState[];
  routes: Array<{ id: string; closed: boolean }>;
  resources: { backupGenerators: number; advisoryUses: number };
  incidents: TruthIncident[];
}

/**
 * Reconstructs full truth state at `atTick` — the post-run reveal. Only
 * ever called from Replay Lab against an already-completed, verified
 * artifact; there is no code path from here back into a running session.
 */
export function projectTruthAtTick(events: readonly ReplayTruthEvent[], atTick: number): TruthProjection {
  let latestSystemState: ReplayTruthEvent | null = null;
  const incidents = new Map<string, TruthIncident>();

  for (const event of events) {
    if (event.tick > atTick) {
      break;
    }
    if (event.kind === "SystemStateChanged") {
      latestSystemState = event;
    } else if (event.kind === "TrueIncidentOccurred") {
      const payload = event.payload as { incidentId: string; kind: string; district: string; severity: number };
      incidents.set(payload.incidentId, {
        id: payload.incidentId,
        kind: payload.kind,
        district: payload.district,
        severity: payload.severity,
        active: true,
        chainedFromIncidentId: null,
        occurredTick: event.tick,
        resolvedTick: null,
      });
    } else if (event.kind === "IncidentChained") {
      const payload = event.payload as { incidentId: string; sourceIncidentId: string; district: string; severity: number };
      incidents.set(payload.incidentId, {
        id: payload.incidentId,
        kind: payload.incidentId,
        district: payload.district,
        severity: payload.severity,
        active: true,
        chainedFromIncidentId: payload.sourceIncidentId,
        occurredTick: event.tick,
        resolvedTick: null,
      });
    } else if (event.kind === "IncidentResolved") {
      const payload = event.payload as { incidentId: string; handledTick: number };
      const existing = incidents.get(payload.incidentId);
      if (existing) {
        incidents.set(payload.incidentId, { ...existing, active: false, resolvedTick: payload.handledTick });
      }
    }
  }

  const systemPayload = latestSystemState?.payload as
    | {
        districts?: Record<string, TruthDistrictState>;
        teams?: TruthTeamState[];
        routes?: Record<string, { closed: boolean }>;
        resources?: { backupGenerators: number; advisoryUses: number };
      }
    | undefined;

  const districts = systemPayload?.districts
    ? Object.values(systemPayload.districts).sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const teams = systemPayload?.teams ? [...systemPayload.teams].sort((a, b) => a.teamId.localeCompare(b.teamId)) : [];
  const routes = systemPayload?.routes
    ? Object.entries(systemPayload.routes)
        .map(([id, r]) => ({ id, closed: r.closed }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const resources = systemPayload?.resources ?? { backupGenerators: 0, advisoryUses: 0 };

  return {
    tick: atTick,
    districts,
    teams,
    routes,
    resources,
    incidents: [...incidents.values()].sort((a, b) => a.occurredTick - b.occurredTick),
  };
}

export interface EvidenceProvenanceEntry {
  evidenceId: string;
  claimId: string;
  sourceId: string;
  category: string;
  reliability: number;
  verified: boolean;
  observationId: string | null;
  incidentId: string | null;
  sourceDistrict: string | null;
  observedTick: number;
  deliveredTick: number;
  delayTicks: number;
  reportedContent: string;
  originalContent: string | null;
  distorted: boolean;
  corruptionType: string | null;
  isFalseReport: boolean;
}

/**
 * Links each piece of public evidence back to the truth observation that
 * produced it — including any corruption or delay applied on the way — so
 * a commander can point at a specific false or late report and see the
 * claim / score it influenced. This is the "distortion detector".
 */
export function buildEvidenceProvenance(artifact: ReplayArtifact): EvidenceProvenanceEntry[] {
  const truthByObservationId = new Map<string, { created?: ReplayTruthEvent; corrupted?: ReplayTruthEvent; delayed?: ReplayTruthEvent }>();
  for (const event of artifact.truth.events) {
    if (event.kind === "ObservationCreated" || event.kind === "ObservationCorrupted" || event.kind === "ObservationDelayed") {
      const observationId = (event.payload as { observationId: string }).observationId;
      const existing = truthByObservationId.get(observationId) ?? {};
      if (event.kind === "ObservationCreated") existing.created = event;
      if (event.kind === "ObservationCorrupted") existing.corrupted = event;
      if (event.kind === "ObservationDelayed") existing.delayed = event;
      truthByObservationId.set(observationId, existing);
    }
  }

  const entries: EvidenceProvenanceEntry[] = [];
  for (const event of artifact.player.events) {
    if (event.kind !== "EvidenceRecorded") {
      continue;
    }
    const evidence = (event.payload as { evidence: Evidence }).evidence;
    const observationId = evidence.id.startsWith("evidence:") ? evidence.id.slice("evidence:".length) : null;
    const truth = observationId ? truthByObservationId.get(observationId) : undefined;
    const created = truth?.created?.payload as { incidentId?: string; content?: string; source?: string } | undefined;
    const corrupted = truth?.corrupted?.payload as
      | { corruptionType?: string; original?: string; corrupted?: string; false?: boolean }
      | undefined;
    const delayed = truth?.delayed?.payload as { delayTicks?: number } | undefined;

    const originalContent = created?.content ?? null;
    const isCorrupted = corrupted !== undefined;
    const delayTicks = delayed?.delayTicks ?? Math.max(0, evidence.deliveredTick - evidence.observedTick);

    entries.push({
      evidenceId: evidence.id,
      claimId: evidence.claimId,
      sourceId: evidence.sourceId,
      category: evidence.category,
      reliability: evidence.reliability,
      verified: evidence.verified,
      observationId,
      incidentId: created?.incidentId ?? null,
      sourceDistrict: evidence.claimId.split(":")[1] ?? null,
      observedTick: evidence.observedTick,
      deliveredTick: evidence.deliveredTick,
      delayTicks,
      reportedContent: evidence.content,
      originalContent,
      distorted: isCorrupted || delayTicks > 0,
      corruptionType: corrupted?.corruptionType ?? null,
      isFalseReport: corrupted?.false === true || (isCorrupted && originalContent !== null && originalContent !== evidence.content),
    });
  }

  return entries.sort((a, b) => a.deliveredTick - b.deliveredTick);
}

export type ActionTimelineEntry =
  | { tick: number; kind: "command"; commandName: string; outcome: "accepted" | "rejected"; target: string | null; detail: string | null }
  | { tick: number; kind: "dispatch"; teamId: string; from: string; to: string; etaTick: number }
  | { tick: number; kind: "arrived"; teamId: string; district: string };

export function buildActionTimeline(artifact: ReplayArtifact): ActionTimelineEntry[] {
  const entries: ActionTimelineEntry[] = [];

  for (const entry of artifact.commandTrace) {
    entries.push(commandTraceToTimelineEntry(entry));
  }
  for (const event of artifact.truth.events) {
    if (event.kind === "TeamDispatched") {
      const payload = event.payload as { teamId: string; from: string; to: string; etaTick: number };
      entries.push({ tick: event.tick, kind: "dispatch", teamId: payload.teamId, from: payload.from, to: payload.to, etaTick: payload.etaTick });
    } else if (event.kind === "TeamArrived") {
      const payload = event.payload as { teamId: string; district: string };
      entries.push({ tick: event.tick, kind: "arrived", teamId: payload.teamId, district: payload.district });
    }
  }

  return entries.sort((a, b) => a.tick - b.tick);
}

function commandTraceToTimelineEntry(entry: ReplayCommandTraceEntry): ActionTimelineEntry {
  return {
    tick: entry.issuedTick,
    kind: "command",
    commandName: entry.commandName,
    outcome: entry.outcome,
    target: entry.target,
    detail: entry.outcome === "rejected" ? entry.errorMessage : null,
  };
}

export interface ScoreSeriesPoint {
  tick: number;
  delta: number;
  category: string;
  reason: string;
  total: number;
}

export function buildScoreSeries(artifact: ReplayArtifact): ScoreSeriesPoint[] {
  const points: ScoreSeriesPoint[] = [];
  for (const event of artifact.player.events) {
    if (event.kind === "PublicScoreChanged") {
      const payload = event.payload as { delta: number; category: string; reason: string; total: number };
      points.push({ tick: event.tick, delta: payload.delta, category: payload.category, reason: payload.reason, total: payload.total });
    }
  }
  return points;
}

import type {
  DistrictId,
  DistrictState,
  GlobalState,
  RouteState,
  ScoreState,
  TeamState,
  InternalState,
  TruthState,
} from "@null-city/contracts/truth";
import type { TeamInit, Scenario } from "@null-city/scenario-schema";

export function emptyScore(): ScoreState {
  return {
    total: 0,
    finalPopulationRisk: 0,
    infrastructureAvailability: 0,
    eventsHandledPoints: 0,
    eventsMissedPoints: 0,
    misadvisoryCost: 0,
    wastedDispatchCost: 0,
    decisionDelayPoints: 0,
    resourceEfficiency: 0,
    chainFailurePenalty: 0,
    raw: {
      incidentsHandled: 0,
      incidentsMissed: 0,
      chainedIncidents: 0,
      wastedDispatchTicks: 0,
      decisionDelayTicks: 0,
      incidentsWithoutAction: 0,
      remainingBackupGenerators: 0,
      remainingAdvisories: 0,
    },
    breakdown: [],
  };
}

export interface ObservationRuntime {
  observationId: string;
  incidentId: string;
  sourceId: string;
  observedTick: number;
  deliveryTick: number;
  content: string;
  category: string;
  reliability: number;
  corruptionType: string | null;
  false: boolean;
  verified: boolean;
  lost: boolean;
  lostReason: string | null;
  staleAfterTicks: number | null;
}

export function buildWorldFromScenario(scenario: Scenario): GlobalState {
  const districts = {} as TruthState;
  for (const d of scenario.districts) {
    const base: DistrictState = {
      id: d.id,
      power: d.power,
      communications: d.communications,
      water: d.water,
      traffic: d.traffic,
      medicalCapacity: d.medicalCapacity,
      hazardLevel: d.hazardLevel,
      populationRisk: d.populationRisk,
    };
    districts[d.id] = base;
  }

  const teams: TeamState[] = scenario.teams.map((t: TeamInit) => ({
    teamId: t.teamId,
    type: t.type,
    location: t.startDistrict,
    status: "idle",
    etaTick: null,
    order: null,
    reschedulable: t.reschedulable,
    wastedTicks: 0,
  }));

  const routes: Record<string, RouteState> = {};
  for (const r of scenario.routes) {
    routes[r.id] = { id: r.id, closed: false, closedAtTick: null, closedBy: null, closureHistory: [] };
  }

  const internal: InternalState = {
    incidents: {},
    scheduled: scenario.effects.map((e) => ({
      id: `sched-effect-${e.atTick}-${e.target}-${e.attribute}`,
      dueTick: e.atTick,
      repeatEvery: e.repeatEvery ?? null,
      effect: {
        id: `effect-${e.atTick}-${e.target}-${e.attribute}`,
        kind: e.label ?? "scheduled",
        target: e.target,
        attribute: e.attribute,
        delta: e.delta,
        sourceEvent: null,
        dueTick: e.atTick,
      },
    })),
    verifications: [],
    backupActive: {},
    powerReroute: {},
    commPriority: [],
    channelDegradation: 0,
    lostObservationCount: 0,
    pendingObservationDefs: [],
    workQueue: [],
  };

  return {
    tick: 0,
    phase: "running",
    districts,
    teams,
    routes,
    resources: {
      backupGenerators: scenario.resources.backupGenerators,
      backupGeneratorsTotal: scenario.resources.backupGenerators,
      advisoryUses: scenario.resources.advisoryUses,
      advisoryUsesTotal: scenario.resources.advisoryUses,
      misadvisoryCost: 0,
    },
    effects: [],
    score: emptyScore(),
    internal,
  };
}

export function districtOrder(scenario: Scenario): DistrictId[] {
  return scenario.districts.map((d) => d.id);
}
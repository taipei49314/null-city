import type {
  EventEnvelope,
  KnownRouteState,
  OwnTeamState,
  PlayerEventEnvelope,
  PublicResources,
} from "@null-city/contracts/truth";
import type { Scenario } from "@null-city/scenario-schema";
import { SimulationEngine, type EngineOptions, type PublicAction } from "@null-city/simulation";
import { TruthToPlayerBridge } from "@null-city/epistemics";

/**
 * One outstanding claim-verification job, bound to the *accepted* order that
 * will satisfy it.
 *
 * Audit finding P1-07: the inherited code keyed pending work by team id alone
 * and queued it before `submitCommand`, so a rejected request left a stale
 * mapping and any later "working" state of that team resolved (or refuted) the
 * claim. Binding to `orderId`/`target` means only the work that was actually
 * accepted for this claim can resolve it.
 */
export interface PendingClaimVerification {
  claimId: string;
  teamId: string;
  orderId: string;
  target: string;
  commandId: string;
}

export interface SessionRecord {
  id: string;
  engine: SimulationEngine;
  bridge: TruthToPlayerBridge;
  /** live subscribers receive player events only */
  subscribers: Set<(events: readonly PlayerEventEnvelope[]) => void>;
  /** accepted verification work awaiting resolution, keyed by teamId */
  pendingClaimVerify: Map<string, PendingClaimVerification>;
  /** Canonical public-action ledger for artifact v2 player rebuild. */
  publicActionLedger: PublicAction[];
}

export type SubscribeFn = (events: readonly PlayerEventEnvelope[]) => void;

/**
 * The session hub owns every running engine and fans *player* events out to
 * subscribers. Truth remains inside the engine and never crosses the player bus.
 */
export class SessionHub {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly scenarioLoader: (scenarioId: string) => Scenario;
  private sessionCounter = 0;

  constructor(scenarioLoader: (scenarioId: string) => Scenario) {
    this.scenarioLoader = scenarioLoader;
  }

  nextSessionId(): string {
    for (;;) {
      this.sessionCounter += 1;
      const candidate = `session-${this.sessionCounter}`;
      if (!this.sessions.has(candidate)) {
        return candidate;
      }
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }

  create(options: {
    scenarioId: string;
    seed: number;
    sessionId: string;
    resume?: EngineOptions["resume"];
  }): SessionRecord {
    if (this.sessions.has(options.sessionId)) {
      throw new Error(`session ${options.sessionId} already exists`);
    }
    const scenario = this.scenarioLoader(options.scenarioId);
    const engine = new SimulationEngine({
      scenario,
      seed: options.seed,
      sessionId: options.sessionId,
      resume: options.resume,
    });
    const bridge = this.makeBridge(options.sessionId, options.seed, scenario, engine);
    bridge.ingest([...engine.eventLog]);
    return this.register(options.sessionId, engine, bridge);
  }

  resume(options: {
    scenarioId: string;
    seed: number;
    sessionId: string;
    snapshot: EngineOptions["resume"];
  }): SessionRecord {
    return this.create({
      scenarioId: options.scenarioId,
      seed: options.seed,
      sessionId: options.sessionId,
      resume: options.snapshot,
    });
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  subscribe(sessionId: string, fn: SubscribeFn): () => void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`session ${sessionId} does not exist`);
    }
    record.subscribers.add(fn);
    return () => {
      record.subscribers.delete(fn);
    };
  }

  broadcast(sessionId: string, events: readonly PlayerEventEnvelope[]): void {
    const record = this.sessions.get(sessionId);
    if (!record || events.length === 0) {
      return;
    }
    for (const fn of record.subscribers) {
      try {
        fn(events);
      } catch {
        // isolate subscriber failures
      }
    }
  }

  /**
   * After an engine mutation, translate new truth events into player events and
   * broadcast the public delta.
   */
  publishTruthDelta(record: SessionRecord, beforeSeq: number): PlayerEventEnvelope[] {
    const truthDelta = record.engine.eventLog.slice(beforeSeq) as EventEnvelope[];
    const beforePlayer = record.bridge.store.length;

    // `RunCompleted` must be the last event a player ever sees. The inherited
    // order ingested the whole truth delta first — which emits `RunCompleted`
    // — and only then mirrored operational state, so a final-tick `TeamArrived`
    // appended an `OwnTeamUpdated` *after* the terminal event (audit finding
    // P0-02; visible in the shipped `data/m4-run-a.artifact.json`). Split the
    // delta at `ScenarioCompleted` so the terminal event is ingested last.
    const terminalIndex = truthDelta.findIndex((event) => event.kind === "ScenarioCompleted");
    const beforeTerminal = terminalIndex === -1 ? truthDelta : truthDelta.slice(0, terminalIndex);
    const terminalTail = terminalIndex === -1 ? [] : truthDelta.slice(terminalIndex);

    record.bridge.ingest(beforeTerminal);
    this.mirrorOperationalPublicState(record, truthDelta);
    if (terminalTail.length > 0) {
      record.bridge.ingest(terminalTail);
    }

    const produced = record.bridge.store.log.slice(beforePlayer);
    this.broadcast(record.id, produced);
    return [...produced];
  }

  private mirrorOperationalPublicState(record: SessionRecord, truthDelta: readonly EventEnvelope[]): void {
    const tick = record.engine.currentTick;
    const teamIds = new Set<string>();
    let routesTouched = false;
    let resourcesTouched = false;

    for (const event of truthDelta) {
      if (event.kind === "TeamDispatched" || event.kind === "TeamArrived") {
        const teamId = (event.payload as { teamId: string }).teamId;
        teamIds.add(teamId);
      }
      if (event.kind === "CommandAccepted" || event.kind === "CommandRejected") {
        // refresh all teams/resources after commands — small N
        for (const team of record.engine.worldState.teams) {
          teamIds.add(team.teamId);
        }
        routesTouched = true;
        resourcesTouched = true;
      }
      if (event.kind === "ActionApplied") {
        const action = (event.payload as { action: string }).action;
        if (action.includes("route") || action.includes("close") || action.includes("reopen")) {
          routesTouched = true;
        }
      }
    }

    for (const teamId of teamIds) {
      const team = record.engine.worldState.teams.find((item) => item.teamId === teamId);
      if (!team) {
        continue;
      }
      record.bridge.notifyTeam(tick, toOwnTeam(team));
    }
    if (routesTouched) {
      for (const route of Object.values(record.engine.worldState.routes)) {
        record.bridge.notifyRoute(tick, toKnownRoute(route));
      }
    }
    if (resourcesTouched) {
      record.bridge.notifyResources(tick, {
        backupGenerators: record.engine.worldState.resources.backupGenerators,
        advisoryUses: record.engine.worldState.resources.advisoryUses,
      });
    }

    // Claim-targeted verification resolves only when the *accepted* order for
    // that claim is the one actually being worked. If the order was cancelled
    // or replaced, the job is dropped instead of being resolved by unrelated
    // work (P1-07).
    for (const [teamId, pending] of [...record.pendingClaimVerify]) {
      const team = record.engine.worldState.teams.find((item) => item.teamId === teamId);
      const order = team?.order ?? null;
      const stillTheSameWork =
        team !== undefined &&
        order !== null &&
        order.orderId === pending.orderId &&
        order.target === pending.target &&
        order.task === "verify";
      if (!stillTheSameWork) {
        record.pendingClaimVerify.delete(teamId);
        record.bridge.clearClaimTarget(teamId);
        continue;
      }
      if (team.status === "working" && team.type === "verification") {
        record.bridge.resolveVerification({ tick, teamId, claimId: pending.claimId });
        record.pendingClaimVerify.delete(teamId);
      }
    }
  }

  private makeBridge(
    sessionId: string,
    seed: number,
    scenario: Scenario,
    engine: SimulationEngine,
  ): TruthToPlayerBridge {
    const incidentDistrict = Object.fromEntries(scenario.incidents.map((i) => [i.id, i.district]));
    const initialTeams: OwnTeamState[] = engine.worldState.teams.map(toOwnTeam);
    const initialRoutes: KnownRouteState[] = Object.values(engine.worldState.routes).map(toKnownRoute);
    const initialResources: PublicResources = {
      backupGenerators: engine.worldState.resources.backupGenerators,
      advisoryUses: engine.worldState.resources.advisoryUses,
    };
    return new TruthToPlayerBridge({
      sessionId,
      scenarioId: scenario.id,
      seed,
      totalTicks: scenario.totalTicks,
      incidentDistrict,
      initialTeams,
      initialRoutes,
      initialResources,
    });
  }

  private register(sessionId: string, engine: SimulationEngine, bridge: TruthToPlayerBridge): SessionRecord {
    const record: SessionRecord = {
      id: sessionId,
      engine,
      bridge,
      subscribers: new Set(),
      pendingClaimVerify: new Map<string, PendingClaimVerification>(),
      publicActionLedger: [],
    };
    this.sessions.set(sessionId, record);
    return record;
  }
}

function toOwnTeam(team: {
  teamId: string;
  type: string;
  location: string;
  status: string;
  etaTick: number | null;
  order: { target: string; task: string } | null;
}): OwnTeamState {
  return {
    teamId: team.teamId,
    type: team.type,
    location: team.location as OwnTeamState["location"],
    status: team.status,
    etaTick: team.etaTick,
    orderTarget: (team.order?.target as OwnTeamState["orderTarget"]) ?? null,
    orderTask: team.order?.task ?? null,
  };
}

function toKnownRoute(route: {
  id: string;
  closed: boolean;
  closedAtTick: number | null;
}): KnownRouteState {
  return {
    id: route.id as KnownRouteState["id"],
    closed: route.closed,
    knownClosedAtTick: route.closedAtTick,
  };
}

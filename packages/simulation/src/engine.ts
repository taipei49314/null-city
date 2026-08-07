import {
  canonicalJson,
  clamp,
  eventHash,
  sha256,
  verifyEventStream,
  type CommandEnvelope,
  type CommandName,
  type DistrictId,
  type EventEnvelope,
  type EventKindName,
  type RouteId,
  type TeamState,
  type Tick,
} from "@null-city/contracts/truth";
import type {
  IncidentInit,
  ObservationDef,
  ObservationSource,
  Scenario,
} from "@null-city/scenario-schema";
import { z } from "zod";

import { SimulationClock } from "./clock.js";
import { SeededRandom } from "./prng.js";
import { shortestTravelPath, type TravelPath } from "./graph.js";
import { buildWorldFromScenario, emptyScore, type ObservationRuntime } from "./world.js";
import { computeScore, decisionDelayPointsFor, type ScoreMeta } from "./score.js";

export const ENGINE_PROTOCOL_VERSION = 1 as const;

/**
 * Version of the terminal-state digest layout. Bumped whenever the set of
 * fields covered by `finalStateDigest()` changes, so a digest can never be
 * silently compared across incompatible definitions.
 */
export const STATE_DIGEST_VERSION = 2 as const;

export interface EngineSnapshotData {
  version: typeof ENGINE_PROTOCOL_VERSION;
  protocolVersion: typeof ENGINE_PROTOCOL_VERSION;
  sessionId: string;
  scenarioId: string;
  scenarioDigest: string;
  seed: number;
  tick: Tick;
  sequence: number;
  prngState: number;
  commandSeq: number;
  orderSeq: number;
  chainedCount: number;
  world: ReturnType<typeof buildWorldFromScenario>;
  observations: {
    inFlight: ObservationRuntime[];
    delivered: ObservationRuntime[];
  };
  idempotencyKeys: string[];
  decisionDelayPenalty: number;
  incidentsHandled: string[];
  incidentStartTick: Record<string, Tick>;
  firstActionTickByIncident: Record<string, Tick | null>;
  totalWastedTicks: number;
  events: EventEnvelope[];
}

/** Stable digest of a compiled scenario; binds snapshots to exact scenario bytes. */
export function scenarioDigest(scenario: Scenario): string {
  return sha256(canonicalJson(scenario));
}

export interface EngineOptions {
  scenario: Scenario;
  seed: number;
  sessionId: string;
  resume?: EngineSnapshotData;
}

export interface RunResult {
  sessionId: string;
  scenarioId: string;
  seed: number;
  finalTick: Tick;
  score: ReturnType<typeof buildWorldFromScenario>["score"];
  eventCount: number;
  eventLogHash: string;
  finalStateDigest: string;
  deliveredObservationCount: number;
  activeIncidents: string[];
  handledIncidents: string[];
}

const dispatchParamsSchema = z.object({
  teamId: z.string().min(1),
  target: z.string().min(1),
  task: z.string().min(1),
});
const rerouteParamsSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });
const backupParamsSchema = z.object({ district: z.string().min(1) });
const routeParamsSchema = z.object({ route: z.string().min(1) });
const verificationParamsSchema = z.object({ target: z.string().min(1), teamId: z.string().min(1) });
const advisoryParamsSchema = z.object({
  district: z.string().min(1),
  text: z.string().min(1),
  severity: z.enum(["info", "warning", "evacuation"]),
});
const prioritizeParamsSchema = z.object({ district: z.string().min(1), ticks: z.number().int().min(1).max(540) });
const cancelParamsSchema = z.object({ orderId: z.string().min(1), reason: z.string().default("unspecified") });

/** which team types may carry which tasks */
const TASK_COMPATIBILITY: Record<string, readonly string[]> = {
  power_repair: ["power"],
  comms_repair: ["communications"],
  hazard_control: ["fire"],
  medical_support: ["medical"],
  water_restore: ["power", "fire"],
  verify: ["verification"],
};

const PARAM_SCHEMAS: Record<CommandName, z.ZodTypeAny> = {
  DISPATCH_TEAM: dispatchParamsSchema,
  REROUTE_POWER: rerouteParamsSchema,
  ACTIVATE_BACKUP_GENERATOR: backupParamsSchema,
  CLOSE_ROUTE: routeParamsSchema,
  REOPEN_ROUTE: routeParamsSchema,
  REQUEST_VERIFICATION: verificationParamsSchema,
  INSPECT_DISTRICT: verificationParamsSchema,
  ISSUE_PUBLIC_ADVISORY: advisoryParamsSchema,
  PRIORITIZE_COMMUNICATION: prioritizeParamsSchema,
  CANCEL_ORDER: cancelParamsSchema,
};

export class SimulationEngine {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly sessionId: string;
  readonly clock: SimulationClock;

  private rng: SeededRandom;
  private world: ReturnType<typeof buildWorldFromScenario>;
  private events: EventEnvelope[] = [];
  private inFlight: ObservationRuntime[] = [];
  private delivered: ObservationRuntime[] = [];
  private sources: Record<string, ObservationSource>;
  private idempotencyKeys = new Set<string>();
  private commandSeq = 0;
  private orderSeq = 0;
  private sequence = 0;
  private incidentStartTick: Record<string, Tick> = {};
  private firstActionTickByIncident: Record<string, Tick | null> = {};
  private decisionDelayPenalty = 0;
  private decisionDelayTicks = 0;
  private incidentsWithoutAction = 0;
  private incidentsHandled: string[] = [];
  private totalWastedTicks = 0;
  private chainedCount = 0;
  private terminalEmitted = false;
  private frozenScore: ReturnType<typeof buildWorldFromScenario>["score"] | null = null;

  constructor(options: EngineOptions) {
    this.scenario = options.scenario;
    this.seed = options.seed;
    this.sessionId = options.sessionId;
    this.sources = Object.fromEntries(options.scenario.sources.map((s) => [s.id, s]));
    this.clock = new SimulationClock(options.scenario.totalTicks);

    if (options.resume) {
      const resume = validateResumeBinding({ ...options, resume: options.resume });
      this.rng = SeededRandom.fromState(resume.prngState);
      // Detach every future-output-affecting value from the caller's object graph.
      this.world = structuredClone(resume.world);
      this.events = structuredClone(resume.events);
      this.inFlight = structuredClone(resume.observations.inFlight);
      this.delivered = structuredClone(resume.observations.delivered);
      this.idempotencyKeys = new Set(resume.idempotencyKeys);
      this.commandSeq = resume.commandSeq;
      this.orderSeq = resume.orderSeq;
      this.sequence = resume.sequence;
      this.incidentStartTick = { ...resume.incidentStartTick };
      this.firstActionTickByIncident = { ...(resume.firstActionTickByIncident ?? {}) };
      this.decisionDelayPenalty = resume.decisionDelayPenalty;
      this.incidentsHandled = [...resume.incidentsHandled];
      this.totalWastedTicks = resume.totalWastedTicks;
      this.chainedCount = resume.chainedCount;
      this.clock.forceTick(resume.tick);
      // Delay bookkeeping is fully derivable from incident start ticks and
      // first-action ticks, so recompute it rather than trusting the header.
      this.updateDecisionDelay(resume.tick);
      if (this.world.tick !== resume.tick) {
        throw new Error("snapshot world tick does not match snapshot header");
      }
      if (this.world.phase === "completed") {
        this.terminalEmitted = true;
        this.frozenScore = structuredClone(this.world.score);
      }
    } else {
      this.rng = new SeededRandom(options.seed);
      this.world = buildWorldFromScenario(options.scenario);
      this.emit("ScenarioStarted", {
        scenarioId: options.scenario.id,
        seed: options.seed,
        tickPerSimSecond: options.scenario.tickDurationSeconds,
        totalTicks: options.scenario.totalTicks,
        districts: options.scenario.districts.map((d) => d.id),
      });
    }
  }

  get eventLog(): readonly EventEnvelope[] {
    return this.events;
  }

  get eventLogHash(): string {
    if (this.events.length === 0) {
      return "";
    }
    return this.events[this.events.length - 1]!.hash;
  }

  get worldState() {
    return this.world;
  }

  get deliveredObservations(): readonly ObservationRuntime[] {
    return this.delivered;
  }

  get currentTick(): Tick {
    return this.clock.tick();
  }

  private emit(kind: EventKindName, payload: unknown): EventEnvelope {
    const previousHash = this.events.length > 0 ? this.events[this.events.length - 1]!.hash : "";
    const envelope = {
      sessionId: this.sessionId,
      sequence: this.sequence,
      tick: this.clock.tick(),
      kind,
      // deep-clone so later world mutations can never retroactively change
      // an already-hashed event payload
      payload: structuredClone(payload) as never,
      previousHash,
      hash: "",
    };
    this.sequence += 1;
    envelope.hash = eventHash(envelope);
    this.events.push(envelope);
    return envelope;
  }

  private nextCommandId(): string {
    this.commandSeq += 1;
    return `cmd-${this.commandSeq}`;
  }

  private nextOrderId(): string {
    this.orderSeq += 1;
    return `order-${this.orderSeq}`;
  }

  /** advances one tick; returns true while the simulation is still running */
  step(): boolean {
    if (this.world.phase === "completed" || this.clock.isComplete()) {
      return false;
    }
    const tick = this.clock.advance();
    this.world.tick = tick;

    this.processIncidents(tick);
    this.processScheduledEffects(tick);
    this.processTeams(tick);
    this.processObservations(tick);
    this.processDynamics(tick);
    this.processVerifications();

    this.emit("SystemStateChanged", this.systemDigest());
    this.recomputeScore(tick);

    if (tick === this.clock.totalTicks) {
      this.finalizeRun(tick);
      return false;
    }
    return true;
  }

  private finalizeRun(tick: Tick): void {
    if (this.terminalEmitted) {
      return;
    }
    this.world.phase = "completed";
    this.frozenScore = structuredClone(this.world.score);
    this.world.score = structuredClone(this.frozenScore);
    this.emit("ScenarioCompleted", {
      finalScore: structuredClone(this.frozenScore),
      finalTick: tick,
    });
    this.terminalEmitted = true;
  }

  /** runs every remaining tick and returns the final result */
  runToEnd(): RunResult {
    let guard = 0;
    while (this.step()) {
      guard += 1;
      if (guard > this.clock.totalTicks + 1) {
        throw new Error("runToEnd exceeded totalTicks guard");
      }
    }
    return this.result();
  }

  result(): RunResult {
    const digest = this.finalStateDigest();
    const activeIncidents = Object.values(this.world.internal.incidents)
      .filter((i) => i.active)
      .map((i) => i.id);
    return {
      sessionId: this.sessionId,
      scenarioId: this.scenario.id,
      seed: this.seed,
      finalTick: this.clock.tick(),
      score: this.world.score,
      eventCount: this.events.length,
      eventLogHash: this.eventLogHash,
      finalStateDigest: digest,
      deliveredObservationCount: this.delivered.length,
      activeIncidents,
      handledIncidents: [...this.incidentsHandled],
    };
  }

  /**
   * Complete, versioned, key-order-independent digest of terminal truth state.
   *
   * Audit finding P1-05: the inherited digest covered only tick, a few
   * district attributes, team status/location, route open/closed, score total
   * and phase. Resources, team orders/ETAs, incident detail, observation
   * queues, PRNG state, counters, idempotency state, the full score breakdown
   * and scheduled effects were all outside it, so two materially different
   * terminal worlds could share a digest. This now covers every
   * future-output-affecting value the snapshot carries, minus the event log
   * (which has its own hash chain).
   */
  finalStateDigest(): string {
    return canonicalJson({
      digestVersion: STATE_DIGEST_VERSION,
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      scenarioId: this.scenario.id,
      scenarioDigest: scenarioDigest(this.scenario),
      seed: this.seed,
      tick: this.clock.tick(),
      sequence: this.sequence,
      phase: this.world.phase,
      prngState: this.rng.sampleState(),
      commandSeq: this.commandSeq,
      orderSeq: this.orderSeq,
      chainedCount: this.chainedCount,
      totalWastedTicks: this.totalWastedTicks,
      decisionDelayPenalty: this.decisionDelayPenalty,
      decisionDelayTicks: this.decisionDelayTicks,
      incidentsWithoutAction: this.incidentsWithoutAction,
      incidentsHandled: [...this.incidentsHandled].sort(),
      incidentStartTick: this.incidentStartTick,
      firstActionTickByIncident: this.firstActionTickByIncident,
      idempotencyKeys: [...this.idempotencyKeys].sort(),
      districts: this.world.districts,
      teams: [...this.world.teams].sort((a, b) => (a.teamId < b.teamId ? -1 : 1)),
      routes: this.world.routes,
      resources: this.world.resources,
      effects: this.world.effects,
      score: this.world.score,
      internal: this.world.internal,
      observations: {
        inFlight: [...this.inFlight].sort((a, b) => (a.observationId < b.observationId ? -1 : 1)),
        delivered: [...this.delivered].sort((a, b) => (a.observationId < b.observationId ? -1 : 1)),
      },
    });
  }

  private systemDigest() {
    return {
      districts: this.world.districts,
      teams: this.world.teams.map((t) => ({
        teamId: t.teamId,
        status: t.status,
        location: t.location,
        etaTick: t.etaTick,
        order: t.order,
      })),
      routes: Object.fromEntries(
        Object.values(this.world.routes).map((r) => [r.id, { closed: r.closed }]),
      ),
      resources: {
        backupGenerators: this.world.resources.backupGenerators,
        advisoryUses: this.world.resources.advisoryUses,
      },
    };
  }

  // ------------------------------------------------------------------ incidents

  private processIncidents(tick: Tick): void {
    const incidentDefs = this.scenario.incidents.filter((i) => i.atTick === tick);
    for (const def of incidentDefs) {
      this.activateIncident(def, tick, null);
    }

    for (const incident of Object.values(this.world.internal.incidents)) {
      if (!incident.active) {
        continue;
      }
      const def = this.scenario.incidents.find((i) => i.id === incident.id);
      if (!def) {
        continue;
      }

      const district = this.world.districts[incident.district]!;
      const matchingTeams = this.world.teams.filter(
        (t) =>
          t.status === "working" &&
          t.location === incident.district &&
          t.order !== null &&
          def.handledBy.includes(t.order.task),
      );

      if (matchingTeams.length > 0) {
        // "Effective" milestone from docs/scoring.md: an applicable team is
        // actually working the incident's district. Recording it here means a
        // team pre-positioned before the incident started counts as an
        // immediate response instead of as "never acted on" (P1-06).
        if (this.firstActionTickByIncident[incident.id] === undefined) {
          this.firstActionTickByIncident[incident.id] = tick;
        }
        const recovery = 6 * matchingTeams.length;
        incident.severity = clamp(incident.severity - recovery, 0, 100);
        if (incident.severity <= 0) {
          incident.active = false;
          incident.handledTick = tick;
          this.incidentsHandled.push(incident.id);
          this.emit("IncidentResolved", {
            incidentId: incident.id,
            district: incident.district,
            handledTick: tick,
          });
          continue;
        }
      }

      // apply the incident pressure to the district
      const before = district[def.effect.attribute];
      district[def.effect.attribute] = clamp(
        before + def.effect.delta,
        0,
        100,
      );
      this.emit("ActionApplied", {
        action: "incident_pressure",
        target: incident.district,
        attribute: def.effect.attribute,
        delta: def.effect.delta,
        result: district[def.effect.attribute],
      });
    }

    // evaluate chained triggers for incidents that have not activated yet
    for (const def of this.scenario.incidents) {
      if (!def.chainTrigger) {
        continue;
      }
      const target = this.world.internal.incidents[def.id];
      if (target && target.active) {
        continue;
      }
      this.monitorChainTrigger(def, tick);
    }
  }

  private monitorChainTrigger(def: IncidentInit, tick: Tick): void {
    const trigger = def.chainTrigger!;
    const source = this.world.internal.incidents[trigger.sourceIncidentId];
    if (!source || !source.active) {
      return;
    }
    const district = trigger.district ?? source.district;
    const value = this.world.districts[district]![trigger.attribute];
    const state = this.world.internal.workQueue.find(
      (w) => w.kind === "chain-monitor" && w.payload.incidentId === def.id,
    );
    if (value < trigger.below) {
      const ticks = ((state?.payload.count as number) ?? 0) + 1;
      if (state) {
        state.payload.count = ticks;
      } else {
        this.world.internal.workQueue.push({
          id: `chain-monitor-${def.id}`,
          kind: "chain-monitor",
          tick,
          payload: { incidentId: def.id, count: ticks },
        });
      }
      if (ticks >= trigger.forTicks) {
        this.world.internal.workQueue = this.world.internal.workQueue.filter(
          (w) => w.kind !== "chain-monitor" || w.payload.incidentId !== def.id,
        );
        this.activateIncident(def, tick, source.id);
      }
    } else {
      this.world.internal.workQueue = this.world.internal.workQueue.filter(
        (w) => w.kind !== "chain-monitor" || w.payload.incidentId !== def.id,
      );
    }
  }

  private activateIncident(def: IncidentInit, tick: Tick, chainedFrom: string | null): void {
    const existing = this.world.internal.incidents[def.id];
    if (existing && existing.active) {
      return;
    }
    // Resolved incidents must not reactivate (including chained re-triggers).
    if (existing && existing.handledTick !== null) {
      return;
    }
    const chained = chainedFrom !== null;
    this.world.internal.incidents[def.id] = {
      id: def.id,
      kind: def.kind,
      district: def.district,
      severity: def.severity,
      active: true,
      startTick: tick,
      handledTick: null,
      chained,
    };
    this.incidentStartTick[def.id] = tick;
    if (chained) {
      this.chainedCount += 1;
      this.emit("IncidentChained", {
        incidentId: def.id,
        sourceIncidentId: chainedFrom,
        district: def.district,
        severity: def.severity,
      });
      this.emit("TrueIncidentOccurred", {
        incidentId: def.id,
        kind: def.kind,
        district: def.district,
        severity: def.severity,
      });
    } else {
      this.emit("TrueIncidentOccurred", {
        incidentId: def.id,
        kind: def.kind,
        district: def.district,
        severity: def.severity,
      });
    }
    this.scheduleObservationsForIncident(def, tick);
  }

  // ------------------------------------------------------------------ scheduled effects

  private processScheduledEffects(tick: Tick): void {
    const due = this.world.internal.scheduled.filter((s) => s.dueTick === tick);
    for (const s of due) {
      this.applyEffect(s.effect, "scheduled");
      if (s.repeatEvery !== null) {
        s.dueTick = tick + s.repeatEvery;
      }
    }
  }

  private applyEffect(
    effect: { target: DistrictId; attribute: string; delta: number; kind: string },
    action: string,
  ): void {
    const district = this.world.districts[effect.target];
    if (!district) {
      return;
    }
    const key = effect.attribute as keyof typeof district;
    const before = district[key] as number;
    const after = clamp(before + effect.delta, 0, 100);
    (district as unknown as Record<string, unknown>)[key] = after;
    this.emit("ActionApplied", {
      action,
      target: effect.target,
      attribute: effect.attribute,
      delta: effect.delta,
      result: after,
    });
  }

  // ------------------------------------------------------------------ teams

  private processTeams(tick: Tick): void {
    for (const team of this.world.teams) {
      if (team.status === "transit" && team.etaTick !== null && team.etaTick <= tick) {
        team.status = "working";
        team.etaTick = null;
        team.location = team.order!.target;
        this.emit("TeamArrived", {
          teamId: team.teamId,
          orderId: team.order?.orderId ?? "",
          district: team.location,
        });
      }

      if (team.status === "working" && team.order !== null) {
        this.applyTeamWork(team);
      }
    }
  }

  private applyTeamWork(team: TeamState): void {
    const district = this.world.districts[team.order!.target];
    if (!district) {
      return;
    }
    const task = team.order!.task;
    const effects: Array<{ attribute: keyof typeof district; delta: number }> = [];
    switch (task) {
      case "power_repair":
        effects.push({ attribute: "power", delta: 4 });
        break;
      case "comms_repair":
        effects.push({ attribute: "communications", delta: 4 });
        break;
      case "hazard_control":
        effects.push({ attribute: "hazardLevel", delta: -6 });
        break;
      case "medical_support":
        effects.push({ attribute: "medicalCapacity", delta: 5 }, { attribute: "populationRisk", delta: -3 });
        break;
      case "water_restore":
        effects.push({ attribute: "water", delta: 4 });
        break;
      case "verify":
        // handled by processVerifications
        break;
      default:
        break;
    }
    for (const e of effects) {
      const key = e.attribute;
      const before = district[key] as number;
      const after = clamp(before + e.delta, 0, 100);
      if (Math.abs(after - before) < 0.009) {
        continue;
      }
      (district as unknown as Record<string, unknown>)[key] = after;
      this.emit("ActionApplied", {
        action: `team_work_${task}`,
        target: team.order!.target,
        attribute: e.attribute,
        delta: e.delta,
        result: after,
      });
    }
  }

  // ------------------------------------------------------------------ observations

  private scheduleObservationsForIncident(def: IncidentInit, incidentTick: Tick): void {
    const defs = this.scenario.observations.filter(
      (o) =>
        o.incidentId === def.id &&
        (o.relativeToIncidentStart || o.atTick >= incidentTick),
    );
    for (const obs of defs) {
      if (obs.relativeToIncidentStart) {
        this.world.internal.pendingObservationDefs.push({
          atTick: incidentTick + obs.atTick,
          defId: obs.id,
        });
      }
      // absolute-tick observations are created by processObservations when
      // their creation tick arrives; creating them here would double them
    }
  }

  private createObservation(def: ObservationDef): void {
    const source = this.sources[def.sourceId];
    if (!source) {
      throw new Error(`observation ${def.id} references unknown source ${def.sourceId}`);
    }
    const district = this.incidentDistrict(def.incidentId) ?? this.defaultDistrict();
    const degraded = this.world.districts[district]!.communications < 30;
    const priorityActive = this.world.internal.commPriority.some(
      (p) => p.district === district && p.untilTick > this.clock.tick(),
    );

    let delayTicks = def.baseDelayTicks;
    if (degraded) {
      delayTicks = Math.round(delayTicks * (def.degradedDelayMultiplier ?? 1));
    }
    if (priorityActive) {
      delayTicks = Math.max(0, Math.round(delayTicks * 0.5));
    }

    const deliveryTick = this.clock.tick() + delayTicks;
    const reliability = source.reliability;

    const runtime: ObservationRuntime = {
      observationId: `obs-${this.sequence}-${def.id}`,
      incidentId: def.incidentId,
      sourceId: def.sourceId,
      observedTick: this.clock.tick(),
      deliveryTick,
      content: def.content,
      category: def.category,
      reliability,
      corruptionType: null,
      false: false,
      verified: false,
      lost: false,
      lostReason: null,
      staleAfterTicks: def.staleAfterTicks ?? null,
    };

    this.emit("ObservationCreated", {
      observationId: runtime.observationId,
      incidentId: def.incidentId,
      source: def.sourceId,
      observedTick: runtime.observedTick,
      content: def.content,
      reliability,
      category: def.category,
    });

    const corrupted = this.rollCorruption(def, runtime);
    if (corrupted) {
      this.emit("ObservationCorrupted", corrupted.payload);
    }

    if (this.rng.chance(def.lossProbability)) {
      runtime.lost = true;
      runtime.lostReason = "transmission_lost";
      this.world.internal.lostObservationCount += 1;
      this.emit("ObservationLost", {
        observationId: runtime.observationId,
        reason: "transmission_lost",
      });
      return;
    }

    if (def.baseDelayTicks > 0) {
      this.emit("ObservationDelayed", {
        observationId: runtime.observationId,
        newDeliveryTick: deliveryTick,
        delayTicks,
      });
    }

    this.inFlight.push(runtime);
  }

  private rollCorruption(
    def: ObservationDef,
    runtime: ObservationRuntime,
  ): { payload: { observationId: string; corruptionType: string; original: string; corrupted: string; false: boolean } } | null {
    const table = def.corruption ?? [];
    if (table.length === 0) {
      return null;
    }
    const totalProbability = table.reduce((acc, c) => acc + c.probability, 0);
    if (totalProbability <= 0) {
      return null;
    }
    if (!this.rng.chance(Math.min(1, totalProbability))) {
      return null;
    }
    let roll = this.rng.next() * totalProbability;
    let selected = table[0]!;
    for (const entry of table) {
      roll -= entry.probability;
      if (roll <= 0) {
        selected = entry;
        break;
      }
    }
    runtime.content = selected.text;
    runtime.corruptionType = selected.type;
    runtime.false = selected.false;
    return {
      payload: {
        observationId: runtime.observationId,
        corruptionType: selected.type,
        original: def.content,
        corrupted: selected.text,
        false: selected.false,
      },
    };
  }

  private processObservations(tick: Tick): void {
    // degrade in-flight deliveries when the district communication channel is weak
    for (const obs of this.inFlight) {
      if (obs.lost || obs.deliveryTick > tick) {
        if (!obs.lost && obs.deliveryTick > tick) {
          const district = this.incidentDistrict(obs.incidentId) ?? this.defaultDistrict();
          const comm = this.world.districts[district]!.communications;
          if (comm < 30) {
            obs.deliveryTick += 1;
            this.emit("ObservationDelayed", {
              observationId: obs.observationId,
              newDeliveryTick: obs.deliveryTick,
              delayTicks: obs.deliveryTick - obs.observedTick,
            });
          }
        }
      }
    }

    // create observations whose creation tick has arrived
    const dueDefs = this.scenario.observations.filter((o) => o.atTick === tick && !o.relativeToIncidentStart);
    for (const def of dueDefs) {
      const incident = this.world.internal.incidents[def.incidentId];
      if (!incident || !incident.active) {
        continue;
      }
      this.createObservation(def);
    }

    // create relative-to-incident-start observations that came due
    const pending = this.world.internal.pendingObservationDefs.filter((p) => p.atTick <= tick);
    if (pending.length > 0) {
      for (const p of pending) {
        const def = this.scenario.observations.find((o) => o.id === p.defId);
        if (def) {
          this.createObservation(def);
        }
      }
      this.world.internal.pendingObservationDefs = this.world.internal.pendingObservationDefs.filter(
        (p) => p.atTick > tick,
      );
    }

    // deliver due observations
    const delivering = this.inFlight.filter((o) => !o.lost && o.deliveryTick <= tick);
    for (const obs of delivering) {
      if (obs.staleAfterTicks !== null && tick - obs.observedTick > obs.staleAfterTicks) {
        obs.lost = true;
        obs.lostReason = "outdated_by_timeout";
        this.world.internal.lostObservationCount += 1;
        this.emit("ObservationLost", {
          observationId: obs.observationId,
          reason: "outdated_by_timeout",
        });
        continue;
      }
      obs.deliveryTick = tick;
      this.delivered.push(obs);
      this.emit("ObservationDelivered", {
        observationId: obs.observationId,
        deliveredTick: tick,
      });
    }
    this.inFlight = this.inFlight.filter((o) => !o.lost && o.deliveryTick > tick);
  }

  private incidentDistrict(incidentId: string): DistrictId | null {
    return this.world.internal.incidents[incidentId]?.district ?? null;
  }

  /** defensive fallback only; every real observation's incident is active by construction */
  private defaultDistrict(): DistrictId {
    return this.scenario.districts[0]!.id;
  }

  // ------------------------------------------------------------------ dynamics

  private processDynamics(tick: Tick): void {
    // backup generators keep a power floor while active
    for (const [district, untilTick] of Object.entries(this.world.internal.backupActive)) {
      const d = this.world.districts[district as DistrictId];
      if (!d || untilTick === undefined) {
        continue;
      }
      if (untilTick <= tick) {
        delete this.world.internal.backupActive[district as DistrictId];
        this.emit("ActionApplied", {
          action: "backup_generator_expired",
          target: district as DistrictId,
          attribute: "power",
          delta: 0,
          result: d.power,
        });
      } else if (d.power < 40) {
        const before = d.power;
        d.power = 40;
        if (before !== 40) {
          this.emit("ActionApplied", {
            action: "backup_generator_floor",
            target: district as DistrictId,
            attribute: "power",
            delta: 40 - before,
            result: 40,
          });
        }
      }
    }

    // expire communication priorities
    this.world.internal.commPriority = this.world.internal.commPriority.filter(
      (p) => p.untilTick > tick,
    );
  }

  private processVerifications(): void {
    for (const team of this.world.teams) {
      if (team.type !== "verification" || team.status !== "working" || team.order === null) {
        continue;
      }
      const target = team.order.target;
      for (const obs of this.delivered) {
        if (!obs.verified && this.incidentDistrict(obs.incidentId) === target) {
          obs.verified = true;
        }
      }
    }
  }

  // ------------------------------------------------------------------ scoring

  private recomputeScore(tick: Tick): void {
    this.updateDecisionDelay(tick);
    const meta: ScoreMeta = {
      handledIncidents: this.incidentsHandled.length,
      activeIncidentsAtEnd: this.clock.isComplete()
        ? Object.values(this.world.internal.incidents).filter((i) => i.active).length
        : 0,
      chainedIncidentCount: this.chainedCount,
      wastedTicks: this.totalWastedTicks,
      misadvisoryCost: this.world.resources.misadvisoryCost,
      remainingBackupGenerators: this.world.resources.backupGenerators,
      remainingAdvisories: this.world.resources.advisoryUses,
      decisionDelayPenalty: this.decisionDelayPenalty,
      decisionDelayTicks: this.decisionDelayTicks,
      incidentsWithoutAction: this.incidentsWithoutAction,
    };

    const { score, diffs } = computeScore(this.world.districts, meta, this.world.score, tick);
    for (const diff of diffs) {
      this.emit("ScoreChanged", {
        delta: diff.delta,
        reason: diff.reason,
        category: diff.id,
        total: score.total,
      });
    }
    this.world.score = score;
  }

  // ------------------------------------------------------------------ commands

  /**
   * Submits a command at the current tick. Commands are validated first;
   * validation failures produce CommandRejected events and no side effects.
   * Re-submitting the same idempotency key never executes twice.
   */
  submitCommand(
    commandName: CommandName,
    rawParams: Record<string, unknown>,
    idempotencyKey: string,
  ): CommandEnvelope {
    const issuedTick = this.clock.tick();
    const target =
      (rawParams["target"] as string) ??
      (rawParams["district"] as string) ??
      (rawParams["route"] as string) ??
      "";

    // Completed runs are immutable: reject without emitting events or mutating counters.
    if (this.world.phase === "completed") {
      return {
        commandId: "cmd-rejected-completed",
        idempotencyKey,
        commandName,
        issuedTick,
        target,
        params: rawParams,
        validation: {
          valid: false,
          errorCode: "run_completed",
          errorMessage: "run is completed and immutable",
        },
        state: "rejected",
        etaTick: null,
        result: { ok: false, detail: "run is completed and immutable" },
      };
    }

    const commandId = this.nextCommandId();

    const envelope: CommandEnvelope = {
      commandId,
      idempotencyKey,
      commandName,
      issuedTick,
      target,
      params: rawParams,
      validation: { valid: true, errorCode: null, errorMessage: null },
      state: "pending",
      etaTick: null,
      result: null,
    };

    this.emit("CommandIssued", {
      commandId,
      commandName,
      idempotencyKey,
      issuedTick,
      target: envelope.target,
      params: rawParams,
    });

    if (this.idempotencyKeys.has(idempotencyKey)) {
      return this.reject(envelope, "duplicate_command", `idempotency key ${idempotencyKey} already executed`);
    }

    const schema = PARAM_SCHEMAS[commandName];
    if (!schema) {
      return this.reject(envelope, "unknown_command", `unknown command ${commandName}`);
    }
    const parsed = schema.safeParse(rawParams);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return this.reject(
        envelope,
        "invalid_params",
        issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid parameters",
      );
    }
    const params = parsed.data as never;

    const outcome = this.executeCommand(commandName, params);
    if (!outcome.accepted) {
      return this.reject(envelope, outcome.code, outcome.reason);
    }
    this.idempotencyKeys.add(idempotencyKey);
    envelope.state = "accepted";
    envelope.etaTick = outcome.etaTick;
    envelope.result = { ok: true, detail: outcome.detail };
    this.emit("CommandAccepted", {
      commandId,
      idempotencyKey,
      etaTick: outcome.etaTick,
    });
    // actions such as cancel/re-route or misadvisory change the score model
    // immediately; recompute so the breakdown is always explainable
    this.recomputeScore(this.clock.tick());
    return envelope;
  }

  private reject(envelope: CommandEnvelope, code: string, reason: string): CommandEnvelope {
    envelope.validation = { valid: false, errorCode: code, errorMessage: reason };
    envelope.state = "rejected";
    envelope.result = { ok: false, detail: reason };
    this.emit("CommandRejected", {
      commandId: envelope.commandId,
      reason,
      code,
    });
    return envelope;
  }

  private executeCommand(
    commandName: CommandName,
    params: Record<string, unknown>,
  ): { accepted: boolean; code: string; reason: string; etaTick: Tick | null; detail: string } {
    const tick = this.clock.tick();
    switch (commandName) {
      case "DISPATCH_TEAM":
        return this.dispatchTeam(params);
      case "REQUEST_VERIFICATION":
      case "INSPECT_DISTRICT":
        return this.requestVerification(params);
      case "REROUTE_POWER":
        return this.reroutePower(params);
      case "ACTIVATE_BACKUP_GENERATOR":
        return this.activateBackup(params);
      case "CLOSE_ROUTE":
        return this.closeRoute(params);
      case "REOPEN_ROUTE":
        return this.reopenRoute(params);
      case "ISSUE_PUBLIC_ADVISORY":
        return this.issueAdvisory(params, tick);
      case "PRIORITIZE_COMMUNICATION":
        return this.prioritizeCommunication(params, tick);
      case "CANCEL_ORDER":
        return this.cancelOrder(params, tick);
      default:
        return { accepted: false, code: "unknown_command", reason: `unknown command ${commandName}`, etaTick: null, detail: "" };
    }
  }

  private travelFromTo(from: DistrictId, to: DistrictId): TravelPath | null {
    const closed = new Set(
      Object.values(this.world.routes)
        .filter((r) => r.closed)
        .map((r) => r.id),
    );
    return shortestTravelPath(from, to, this.scenario.routes, closed);
  }

  private dispatchTeam(params: Record<string, unknown>) {
    const { teamId, target, task } = params as { teamId: string; target: DistrictId; task: string };
    const team = this.world.teams.find((t) => t.teamId === teamId);
    if (!team) {
      return { accepted: false, code: "unknown_team", reason: `team ${teamId} does not exist`, etaTick: null, detail: "" };
    }
    if (!this.world.districts[target]) {
      return { accepted: false, code: "unknown_district", reason: `district ${target} does not exist`, etaTick: null, detail: "" };
    }
    const compatible = TASK_COMPATIBILITY[task];
    if (!compatible || !compatible.includes(team.type)) {
      return {
        accepted: false,
        code: "task_incompatible",
        reason: `team type ${team.type} cannot perform task ${task}`,
        etaTick: null,
        detail: "",
      };
    }
    if (team.status === "transit") {
      return {
        accepted: false,
        code: "team_in_transit",
        reason: `team ${teamId} is in transit; cancel its order first`,
        etaTick: null,
        detail: "",
      };
    }
    if (team.status === "working" && !team.reschedulable) {
      return {
        accepted: false,
        code: "team_not_reschedulable",
        reason: `team ${teamId} is working and cannot be re-dispatched`,
        etaTick: null,
        detail: "",
      };
    }
    const path = this.travelFromTo(team.location, target);
    if (!path) {
      return {
        accepted: false,
        code: "no_open_route",
        reason: `no open route from ${team.location} to ${target}; check closed roads`,
        etaTick: null,
        detail: "",
      };
    }
    const travelTicks = path.travelTicks;
    const etaTick = this.clock.tick() + travelTicks;
    const orderId = this.nextOrderId();
    team.status = "transit";
    team.etaTick = etaTick;
    team.order = { orderId, origin: "original", target, task };
    this.emit("TeamDispatched", {
      teamId,
      orderId,
      from: team.location,
      to: target,
      travelTicks,
      etaTick,
    });
    this.recordFirstAction(target, this.clock.tick());
    return { accepted: true, code: "", reason: "", etaTick, detail: `${teamId} dispatched to ${target} (${task})` };
  }

  private requestVerification(params: Record<string, unknown>) {
    return this.dispatchTeam({ teamId: params["teamId"], target: params["target"], task: "verify" });
  }

  private reroutePower(params: Record<string, unknown>) {
    const { from, to } = params as { from: DistrictId; to: DistrictId };
    const fromD = this.world.districts[from];
    const toD = this.world.districts[to];
    if (!fromD || !toD) {
      return { accepted: false, code: "unknown_district", reason: `unknown district in reroute`, etaTick: null, detail: "" };
    }
    if (from === to) {
      return { accepted: false, code: "same_district", reason: "cannot reroute a district into itself", etaTick: null, detail: "" };
    }
    const take = 10;
    const give = 15;
    const beforeFrom = fromD.power;
    const beforeTo = toD.power;
    fromD.power = clamp(fromD.power - take, 0, 100);
    toD.power = clamp(toD.power + give, 0, 100);
    this.world.internal.powerReroute[to] = from;
    this.emit("ActionApplied", {
      action: "power_reroute",
      target: from,
      attribute: "power",
      delta: -take,
      result: fromD.power,
    });
    this.emit("ActionApplied", {
      action: "power_reroute",
      target: to,
      attribute: "power",
      delta: give,
      result: toD.power,
    });
    this.recordFirstAction(to, this.clock.tick());
    return {
      accepted: true,
      code: "",
      reason: "",
      etaTick: null,
      detail: `rerouted power from ${from} to ${to} (${beforeFrom}->${fromD.power}, ${beforeTo}->${toD.power})`,
    };
  }

  private activateBackup(params: Record<string, unknown>) {
    const district = params["district"] as DistrictId;
    const d = this.world.districts[district];
    if (!d) {
      return { accepted: false, code: "unknown_district", reason: `district ${district} does not exist`, etaTick: null, detail: "" };
    }
    if (this.world.resources.backupGenerators <= 0) {
      return { accepted: false, code: "no_backup_generators", reason: "no backup generators remaining", etaTick: null, detail: "" };
    }
    if (this.world.internal.backupActive[district]) {
      return { accepted: false, code: "backup_already_active", reason: `backup generator already active in ${district}`, etaTick: null, detail: "" };
    }
    this.world.resources.backupGenerators -= 1;
    this.world.internal.backupActive[district] = this.clock.tick() + 120;
    this.emit("ActionApplied", {
      action: "backup_generator_active",
      target: district,
      attribute: "power",
      delta: 0,
      result: d.power,
    });
    this.recordFirstAction(district, this.clock.tick());
    return {
      accepted: true,
      code: "",
      reason: "",
      etaTick: null,
      detail: `backup generator activated in ${district} for 120 ticks`,
    };
  }

  private closeRoute(params: Record<string, unknown>) {
    return this.setRouteClosed(params["route"] as RouteId, true);
  }

  private reopenRoute(params: Record<string, unknown>) {
    return this.setRouteClosed(params["route"] as RouteId, false);
  }

  private setRouteClosed(routeId: RouteId, closed: boolean) {
    const route = this.world.routes[routeId];
    if (!route) {
      return { accepted: false, code: "unknown_route", reason: `route ${routeId} does not exist`, etaTick: null, detail: "" };
    }
    if (route.closed === closed) {
      return {
        accepted: false,
        code: "route_already_state",
        reason: `route ${routeId} is already ${closed ? "closed" : "open"}`,
        etaTick: null,
        detail: "",
      };
    }
    // `closedAtTick`/`closedBy` describe the *current* closure only. Reopening
    // clears them and closes out the history entry instead of leaving stale
    // metadata that describes a closure which no longer applies (P2-03).
    const tick = this.clock.tick();
    route.closed = closed;
    if (closed) {
      route.closedAtTick = tick;
      route.closedBy = "command";
      route.closureHistory.push({
        closedAtTick: tick,
        closedBy: "command",
        reopenedAtTick: null,
        reopenedBy: null,
      });
    } else {
      const open = route.closureHistory[route.closureHistory.length - 1];
      if (open && open.reopenedAtTick === null) {
        open.reopenedAtTick = tick;
        open.reopenedBy = "command";
      }
      route.closedAtTick = null;
      route.closedBy = null;
    }
    this.emit("ActionApplied", {
      action: closed ? "route_closed" : "route_reopened",
      target: routeId as unknown as DistrictId,
      attribute: "traffic",
      delta: 0,
      result: closed ? 0 : 100,
    });
    return { accepted: true, code: "", reason: "", etaTick: null, detail: `route ${routeId} ${closed ? "closed" : "reopened"}` };
  }

  private issueAdvisory(params: Record<string, unknown>, tick: Tick) {
    const { district, severity } = params as { district: DistrictId; text: string; severity: "info" | "warning" | "evacuation" };
    const d = this.world.districts[district];
    if (!d) {
      return { accepted: false, code: "unknown_district", reason: `district ${district} does not exist`, etaTick: null, detail: "" };
    }
    if (this.world.resources.advisoryUses <= 0) {
      return { accepted: false, code: "no_advisory_uses", reason: "no public advisory budget remaining", etaTick: null, detail: "" };
    }
    this.world.resources.advisoryUses -= 1;

    let misCost = 0;
    if (severity === "evacuation") {
      if (d.hazardLevel < 60) {
        misCost += 30;
        d.traffic = clamp(d.traffic - 20, 0, 100);
        d.populationRisk = clamp(d.populationRisk + 5, 0, 100);
      } else {
        d.populationRisk = clamp(d.populationRisk - 5, 0, 100);
      }
    } else if (severity === "warning") {
      if (d.hazardLevel < 40) {
        misCost += 10;
        d.traffic = clamp(d.traffic - 8, 0, 100);
      } else {
        d.populationRisk = clamp(d.populationRisk - 3, 0, 100);
      }
    } else {
      d.traffic = clamp(d.traffic - 3, 0, 100);
    }
    if (misCost > 0) {
      this.world.resources.misadvisoryCost += misCost;
    }
    this.emit("ActionApplied", {
      action: "public_advisory",
      target: district,
      attribute: "traffic",
      delta: 0,
      result: d.traffic,
    });
    this.recordFirstAction(district, tick);
    return {
      accepted: true,
      code: "",
      reason: "",
      etaTick: null,
      detail: misCost > 0 ? `advisory issued; caused ${misCost} misadvisory cost` : "advisory issued",
    };
  }

  private prioritizeCommunication(params: Record<string, unknown>, tick: Tick) {
    const { district, ticks } = params as { district: DistrictId; ticks: number };
    if (!this.world.districts[district]) {
      return { accepted: false, code: "unknown_district", reason: `district ${district} does not exist`, etaTick: null, detail: "" };
    }
    const existing = this.world.internal.commPriority.find((p) => p.district === district);
    if (existing) {
      existing.untilTick = Math.max(existing.untilTick, tick + ticks);
    } else {
      this.world.internal.commPriority.push({ district, untilTick: tick + ticks });
    }
    this.emit("ActionApplied", {
      action: "comms_priority",
      target: district,
      attribute: "communications",
      delta: 0,
      result: this.world.districts[district]!.communications,
    });
    return {
      accepted: true,
      code: "",
      reason: "",
      etaTick: null,
      detail: `communication priority in ${district} for ${ticks} ticks`,
    };
  }

  private cancelOrder(params: Record<string, unknown>, tick: Tick) {
    const orderId = params["orderId"] as string;
    const team = this.world.teams.find((t) => t.order?.orderId === orderId);
    if (!team) {
      return { accepted: false, code: "unknown_order", reason: `order ${orderId} not found`, etaTick: null, detail: "" };
    }
    const wasted = team.etaTick !== null ? Math.max(0, team.etaTick - tick) : 0;
    this.totalWastedTicks += wasted;
    team.wastedTicks += wasted;
    const detail = `order ${orderId} cancelled (${team.teamId}); wasted ${wasted} travel ticks`;
    if (team.status === "working") {
      this.emit("ActionApplied", {
        action: "order_cancelled",
        target: team.order!.target,
        attribute: "traffic",
        delta: 0,
        result: 0,
      });
    }
    team.status = "idle";
    team.etaTick = null;
    team.order = null;
    return { accepted: true, code: "", reason: "", etaTick: null, detail };
  }

  private recordFirstAction(district: DistrictId, tick: Tick): void {
    for (const [incidentId, incident] of Object.entries(this.world.internal.incidents)) {
      if (!incident.active || incident.district !== district) {
        continue;
      }
      if (this.firstActionTickByIncident[incidentId] === undefined) {
        this.firstActionTickByIncident[incidentId] = tick;
      }
    }
    this.updateDecisionDelay(this.clock.tick());
  }

  /**
   * Recomputes the decision-delay penalty over *every* incident that has
   * started, at the given tick.
   *
   * Audit finding P1-06: the inherited version only looked at incidents that
   * were both still active *and* already acted on. An incident that was never
   * answered contributed nothing (the worst case scored best), and an
   * incident's accrued delay silently disappeared the moment it was resolved.
   * Now an unanswered incident's delay is measured against the current tick
   * and freezes at its first qualifying action, and a resolved incident keeps
   * the delay it actually incurred.
   */
  private updateDecisionDelay(tick: Tick): void {
    let penalty = 0;
    let delayTicks = 0;
    let withoutAction = 0;
    for (const [incidentId, startTick] of Object.entries(this.incidentStartTick)) {
      const firstAction = this.firstActionTickByIncident[incidentId];
      let responseTick: Tick;
      if (firstAction === null || firstAction === undefined) {
        withoutAction += 1;
        responseTick = Math.max(startTick, tick);
      } else {
        responseTick = firstAction;
      }
      const delay = Math.max(0, responseTick - startTick);
      delayTicks += delay;
      penalty += decisionDelayPointsFor(delay);
    }
    this.decisionDelayPenalty = penalty;
    this.decisionDelayTicks = delayTicks;
    this.incidentsWithoutAction = withoutAction;
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): EngineSnapshotData {
    // Detached value: later engine mutation must not alter a previously taken snapshot.
    return structuredClone({
      version: ENGINE_PROTOCOL_VERSION,
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      scenarioId: this.scenario.id,
      scenarioDigest: scenarioDigest(this.scenario),
      seed: this.seed,
      tick: this.clock.tick(),
      sequence: this.sequence,
      prngState: this.rng.sampleState(),
      commandSeq: this.commandSeq,
      orderSeq: this.orderSeq,
      chainedCount: this.chainedCount,
      world: this.frozenScore
        ? { ...this.world, score: structuredClone(this.frozenScore) }
        : this.world,
      observations: {
        inFlight: this.inFlight,
        delivered: this.delivered,
      },
      idempotencyKeys: [...this.idempotencyKeys],
      decisionDelayPenalty: this.decisionDelayPenalty,
      incidentsHandled: [...this.incidentsHandled],
      incidentStartTick: { ...this.incidentStartTick },
      firstActionTickByIncident: { ...this.firstActionTickByIncident },
      totalWastedTicks: this.totalWastedTicks,
      events: this.events,
    });
  }

  /** applies a previous snapshot into a fresh engine; must be used before any command or step */
  static resume(options: Omit<EngineOptions, "resume"> & { resume: EngineSnapshotData }): SimulationEngine {
    return new SimulationEngine(options);
  }
}

function validateResumeBinding(options: EngineOptions & { resume: EngineSnapshotData }): EngineSnapshotData {
  const resume = options.resume;
  if (resume.version !== ENGINE_PROTOCOL_VERSION || resume.protocolVersion !== ENGINE_PROTOCOL_VERSION) {
    throw new Error(
      `snapshot protocol version unsupported: version=${String(resume.version)} protocol=${String(resume.protocolVersion)}`,
    );
  }
  if (resume.sessionId !== options.sessionId) {
    throw new Error(
      `snapshot session mismatch: snapshot=${resume.sessionId} requested=${options.sessionId}`,
    );
  }
  if (resume.seed !== options.seed) {
    throw new Error(`snapshot seed mismatch: snapshot=${resume.seed} requested=${options.seed}`);
  }
  if (resume.scenarioId !== options.scenario.id) {
    throw new Error(
      `snapshot scenario id mismatch: snapshot=${resume.scenarioId} requested=${options.scenario.id}`,
    );
  }
  const expectedDigest = scenarioDigest(options.scenario);
  if (resume.scenarioDigest !== expectedDigest) {
    throw new Error("snapshot scenario digest mismatch");
  }
  if (typeof resume.chainedCount !== "number" || !Number.isFinite(resume.chainedCount)) {
    throw new Error("snapshot missing chainedCount");
  }
  if (resume.firstActionTickByIncident === undefined || typeof resume.firstActionTickByIncident !== "object") {
    throw new Error("snapshot missing firstActionTickByIncident");
  }
  if (!resume.world || typeof resume.world !== "object") {
    throw new Error("snapshot world is invalid");
  }
  if (!Array.isArray(resume.events)) {
    throw new Error("snapshot events are invalid");
  }
  if (!Number.isInteger(resume.sequence) || resume.sequence !== resume.events.length) {
    throw new Error(
      `snapshot sequence counter mismatch: header=${String(resume.sequence)} events=${resume.events.length}`,
    );
  }
  // The embedded truth log must verify against its own hash chain before it is
  // adopted. `loadSnapshotFromFile` already did this for the CLI path, and
  // resume is no longer reachable from the public transport at all (audit
  // P0-01), but the check stays at the engine boundary every caller shares so
  // no future entry point can skip it. A valid chain is tamper-evidence over
  // the snapshot's own contents, not proof of provenance — see
  // docs/decisions/2026-08-07-authority-and-replay-semantics.md.
  const chain = verifyEventStream([...resume.events], {
    expectedSessionId: resume.sessionId,
    requireNonEmpty: resume.tick > 0 || resume.sequence > 0,
  });
  if (!chain.validChain) {
    throw new Error(
      `snapshot event stream invalid at sequence ${String(chain.brokenAt)} (${chain.reason ?? "unknown"})`,
    );
  }
  return resume;
}

export { emptyScore, buildWorldFromScenario };

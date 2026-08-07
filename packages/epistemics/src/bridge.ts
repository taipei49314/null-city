import type {
  EventEnvelope,
  OwnTeamState,
  KnownRouteState,
  PublicResources,
  PlayerEventEnvelope,
  Claim,
} from "@null-city/contracts/truth";
import { PlayerEventStore } from "./store.js";
import {
  claimIdFor,
  normalizeObservationToEvidence,
  upsertClaimFromEvidence,
  type ObservationPublicFacts,
} from "./claims.js";

interface PendingObservation {
  observationId: string;
  incidentId: string;
  sourceId: string;
  observedTick: number;
  content: string;
  category: string;
  reliability: number;
  districtId: string;
  internallyFalse: boolean;
  staleAfterTicks: number | null;
}

export interface BridgeContext {
  sessionId: string;
  scenarioId: string;
  seed: number;
  totalTicks: number;
  /** District lookup for incidents from scenario (public ids only). */
  incidentDistrict: Record<string, string>;
  initialTeams: OwnTeamState[];
  initialRoutes: KnownRouteState[];
  initialResources: PublicResources;
}

/**
 * Translates batches of internal truth events into public player events.
 * Corruption flags and raw district truth never enter the player stream.
 */
export class TruthToPlayerBridge {
  readonly store = new PlayerEventStore();
  private pending = new Map<string, PendingObservation>();
  private claims = new Map<string, Claim>();
  private started = false;
  private claimTargets = new Map<string, string>(); // teamId -> claimId while verifying

  constructor(private readonly ctx: BridgeContext) {}

  get playerEvents(): readonly PlayerEventEnvelope[] {
    return this.store.log;
  }

  /**
   * Bind a verification team to a claim. Callers must only do this once the
   * command has been *accepted* (audit finding P1-07); a rejected request must
   * leave no targeting behind.
   */
  targetClaim(teamId: string, claimId: string): void {
    this.claimTargets.set(teamId, claimId);
  }

  /** Drop targeting for a team whose verification work no longer exists. */
  clearClaimTarget(teamId: string): void {
    this.claimTargets.delete(teamId);
  }

  ingest(truthEvents: readonly EventEnvelope[]): PlayerEventEnvelope[] {
    const produced: PlayerEventEnvelope[] = [];
    const before = this.store.length;

    for (const event of truthEvents) {
      this.handleTruth(event);
    }

    for (let i = before; i < this.store.length; i += 1) {
      produced.push(this.store.log[i]!);
    }
    return produced;
  }

  private emit(tick: number, kind: PlayerEventEnvelope["kind"], payload: unknown): void {
    this.store.append(this.ctx.sessionId, tick, kind, payload);
  }

  private handleTruth(event: EventEnvelope): void {
    switch (event.kind) {
      case "ScenarioStarted": {
        if (this.started) {
          return;
        }
        this.started = true;
        this.emit(event.tick, "SessionStarted", {
          scenarioId: this.ctx.scenarioId,
          seed: this.ctx.seed,
          totalTicks: this.ctx.totalTicks,
          teams: this.ctx.initialTeams,
          routes: this.ctx.initialRoutes,
          resources: this.ctx.initialResources,
        });
        break;
      }
      case "ObservationCreated": {
        const payload = event.payload as {
          observationId: string;
          incidentId: string;
          source: string;
          observedTick: number;
          content: string;
          reliability: number;
          category: string;
        };
        const districtId = this.ctx.incidentDistrict[payload.incidentId] ?? "unknown";
        this.pending.set(payload.observationId, {
          observationId: payload.observationId,
          incidentId: payload.incidentId,
          sourceId: payload.source,
          observedTick: payload.observedTick,
          content: payload.content,
          category: payload.category,
          reliability: payload.reliability,
          districtId,
          internallyFalse: false,
          staleAfterTicks: null,
        });
        break;
      }
      case "ObservationCorrupted": {
        // Update pending public content only — never emit corruption metadata.
        const payload = event.payload as {
          observationId: string;
          corrupted: string;
          false: boolean;
        };
        const pending = this.pending.get(payload.observationId);
        if (pending) {
          pending.content = payload.corrupted;
          pending.internallyFalse = payload.false;
        }
        break;
      }
      case "ObservationDelivered": {
        const payload = event.payload as { observationId: string; deliveredTick: number };
        const pending = this.pending.get(payload.observationId);
        if (!pending) {
          break;
        }
        const facts: ObservationPublicFacts = { ...pending };
        const claimId = claimIdFor(pending.incidentId, pending.category, pending.districtId);
        const evidence = normalizeObservationToEvidence(facts, payload.deliveredTick, claimId);
        this.emit(event.tick, "EvidenceRecorded", { evidence });
        const existing = this.claims.get(claimId);
        const { claim, reason } = upsertClaimFromEvidence(existing, evidence, facts, event.tick);
        this.claims.set(claimId, claim);
        this.emit(event.tick, "ClaimUpdated", { claim, reason });
        break;
      }
      case "ObservationLost":
      case "ObservationDelayed":
        // Delays/losses are not required on the public feed for M1; content arrives on delivery.
        break;
      case "CommandAccepted":
      case "CommandRejected": {
        // Paired with CommandIssued — emit a single CommandResult from issued+outcome via helpers.
        break;
      }
      case "CommandIssued": {
        // Stored lightly; CommandResult emitted by notifyCommand from server with full outcome.
        break;
      }
      case "TeamDispatched":
      case "TeamArrived": {
        // Server should call notifyTeam with current public team state after these.
        break;
      }
      case "ScoreChanged": {
        const payload = event.payload as {
          delta: number;
          reason: string;
          category: string;
          total: number;
        };
        this.emit(event.tick, "PublicScoreChanged", payload);
        break;
      }
      case "ScenarioCompleted": {
        const payload = event.payload as { finalTick: number; finalScore: { total: number } };
        this.emit(event.tick, "RunCompleted", {
          finalTick: payload.finalTick,
          scoreTotal: payload.finalScore.total,
          claimCount: this.claims.size,
          evidenceCount: [...this.claims.values()].reduce((n, c) => n + c.evidenceIds.length, 0),
        });
        break;
      }
      default:
        break;
    }
  }

  notifyCommand(input: {
    tick: number;
    commandId: string;
    commandName: string;
    idempotencyKey: string;
    state: "accepted" | "rejected";
    errorCode: string | null;
    detail: string | null;
    etaTick: number | null;
    target: string;
  }): PlayerEventEnvelope {
    return this.store.append(this.ctx.sessionId, input.tick, "CommandResult", input);
  }

  notifyTeam(tick: number, team: OwnTeamState): PlayerEventEnvelope {
    return this.store.append(this.ctx.sessionId, tick, "OwnTeamUpdated", { team });
  }

  notifyRoute(tick: number, route: KnownRouteState): PlayerEventEnvelope {
    return this.store.append(this.ctx.sessionId, tick, "KnownRouteUpdated", { route });
  }

  notifyResources(tick: number, resources: PublicResources): PlayerEventEnvelope {
    return this.store.append(this.ctx.sessionId, tick, "ResourcesChanged", { resources });
  }

  notifyAssessment(tick: number, assessment: {
    id: string;
    claimId: string;
    probability: number;
    confidence: number;
    rationale?: string;
    submittedTick: number;
  }): PlayerEventEnvelope {
    return this.store.append(this.ctx.sessionId, tick, "AssessmentSubmitted", { assessment });
  }

  /**
   * Resolve verification against a claim. Uses internal false flag from pending
   * observations in the claim's district — outcome only, never corruption type.
   */
  resolveVerification(input: {
    tick: number;
    teamId: string;
    claimId: string;
  }): PlayerEventEnvelope {
    const claim = this.claims.get(input.claimId);
    let outcome: "verified" | "refuted" | "inconclusive" = "inconclusive";
    if (claim) {
      const related = [...this.pending.values()].filter(
        (item) => claimIdFor(item.incidentId, item.category, item.districtId) === input.claimId,
      );
      if (related.length > 0) {
        outcome = related.some((item) => item.internallyFalse) ? "refuted" : "verified";
        const updated: Claim = {
          ...claim,
          status: outcome,
          lastUpdatedTick: input.tick,
          asOfTick: input.tick,
        };
        this.claims.set(input.claimId, updated);
        this.emit(input.tick, "ClaimUpdated", { claim: updated, reason: outcome });
      }
    }
    this.claimTargets.delete(input.teamId);
    return this.store.append(this.ctx.sessionId, input.tick, "VerificationResolved", {
      claimId: input.claimId,
      teamId: input.teamId,
      outcome,
      resolvedTick: input.tick,
    });
  }

  takeClaimTarget(teamId: string): string | undefined {
    return this.claimTargets.get(teamId);
  }
}

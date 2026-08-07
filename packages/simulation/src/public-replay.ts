import type {
  EventEnvelope,
  KnownRouteState,
  OwnTeamState,
  PlayerEventEnvelope,
  PublicResources,
} from "@null-city/contracts/truth";
import { TruthToPlayerBridge } from "@null-city/epistemics";
import type { Scenario } from "@null-city/scenario-schema";

import { SimulationEngine, type RunResult } from "./engine.js";
import type { PublicAction } from "./public-actions.js";

interface PendingClaimVerification {
  claimId: string;
  teamId: string;
  orderId: string;
  target: string;
  commandId: string;
}

/**
 * Replays a completed run from scenario + seed + the canonical public-action
 * ledger, regenerating both truth and player streams the same way the live
 * session hub does (including claim-targeted verification).
 */
export function replayFromPublicActions(options: {
  scenario: Scenario;
  seed: number;
  sessionId: string;
  actions: readonly PublicAction[];
}): {
  engine: SimulationEngine;
  playerEvents: readonly PlayerEventEnvelope[];
  result: RunResult;
} {
  const { scenario, seed, sessionId, actions } = options;
  const engine = new SimulationEngine({ scenario, seed, sessionId });
  const bridge = makeBridge(sessionId, seed, scenario, engine);
  const pendingClaimVerify = new Map<string, PendingClaimVerification>();

  // Genesis truth (ScenarioStarted) must enter the player projection first.
  publishTruthDelta(engine, bridge, pendingClaimVerify, 0);

  for (const action of actions) {
    advanceToTick(engine, bridge, pendingClaimVerify, action.atTick);
    if (action.kind === "command") {
      applyCommand(engine, bridge, pendingClaimVerify, action);
    } else {
      applyAssessment(engine, bridge, action);
    }
  }

  // Drain the remainder of the scenario.
  while (engine.worldState.phase === "running") {
    const before = engine.eventLog.length;
    const progressed = engine.step();
    publishTruthDelta(engine, bridge, pendingClaimVerify, before);
    if (!progressed) {
      break;
    }
  }

  return {
    engine,
    playerEvents: bridge.playerEvents,
    result: engine.result(),
  };
}

function advanceToTick(
  engine: SimulationEngine,
  bridge: TruthToPlayerBridge,
  pending: Map<string, PendingClaimVerification>,
  targetTick: number,
): void {
  while (engine.currentTick < targetTick && engine.worldState.phase === "running") {
    const before = engine.eventLog.length;
    const progressed = engine.step();
    publishTruthDelta(engine, bridge, pending, before);
    if (!progressed) {
      break;
    }
  }
}

function applyCommand(
  engine: SimulationEngine,
  bridge: TruthToPlayerBridge,
  pending: Map<string, PendingClaimVerification>,
  action: Extract<PublicAction, { kind: "command" }>,
): void {
  const engineParams = { ...action.params };
  let verificationRequest: { teamId: string; claimId: string; target: string } | null = null;

  if (action.commandName === "REQUEST_VERIFICATION") {
    const claimId = typeof engineParams["claimId"] === "string" ? (engineParams["claimId"] as string) : undefined;
    delete engineParams["claimId"];
    // District must already be in params for engine-only ledgers, or derived
    // by the producer (server) before recording. Prefer explicit target from
    // ledger after claim resolution at record time.
    if (claimId && typeof engineParams["target"] === "string") {
      const teamId = String(engineParams["teamId"] ?? "");
      verificationRequest = { teamId, claimId, target: engineParams["target"] as string };
    } else if (claimId) {
      // claimId without target cannot be executed by the engine; skip binding.
      verificationRequest = null;
    }
  }

  const before = engine.eventLog.length;
  const envelope = engine.submitCommand(action.commandName as never, engineParams, action.idempotencyKey);

  if (verificationRequest) {
    if (envelope.state === "accepted") {
      const team = engine.worldState.teams.find((item) => item.teamId === verificationRequest!.teamId);
      const orderId = team?.order?.orderId;
      if (orderId) {
        pending.set(verificationRequest.teamId, {
          claimId: verificationRequest.claimId,
          teamId: verificationRequest.teamId,
          orderId,
          target: verificationRequest.target,
          commandId: envelope.commandId,
        });
        bridge.targetClaim(verificationRequest.teamId, verificationRequest.claimId);
      }
    } else {
      pending.delete(verificationRequest.teamId);
      bridge.clearClaimTarget(verificationRequest.teamId);
    }
  }

  publishTruthDelta(engine, bridge, pending, before);
  bridge.notifyCommand({
    tick: engine.currentTick,
    commandId: envelope.commandId,
    commandName: action.commandName,
    idempotencyKey: action.idempotencyKey,
    state: envelope.state === "accepted" ? "accepted" : "rejected",
    errorCode: envelope.validation.errorCode,
    detail: envelope.result?.detail ?? envelope.validation.errorMessage,
    etaTick: envelope.etaTick,
    target: envelope.target,
  });
}

function applyAssessment(
  engine: SimulationEngine,
  bridge: TruthToPlayerBridge,
  action: Extract<PublicAction, { kind: "assessment" }>,
): void {
  bridge.notifyAssessment(engine.currentTick, {
    id: action.id,
    claimId: action.claimId,
    probability: action.probability,
    confidence: action.confidence,
    ...(action.rationale ? { rationale: action.rationale } : {}),
    submittedTick: action.atTick,
  });
}

function publishTruthDelta(
  engine: SimulationEngine,
  bridge: TruthToPlayerBridge,
  pending: Map<string, PendingClaimVerification>,
  beforeSeq: number,
): void {
  const truthDelta = engine.eventLog.slice(beforeSeq) as EventEnvelope[];
  const terminalIndex = truthDelta.findIndex((event) => event.kind === "ScenarioCompleted");
  const beforeTerminal = terminalIndex === -1 ? truthDelta : truthDelta.slice(0, terminalIndex);
  const terminalTail = terminalIndex === -1 ? [] : truthDelta.slice(terminalIndex);

  bridge.ingest(beforeTerminal);
  mirrorOperationalPublicState(engine, bridge, pending, truthDelta);
  if (terminalTail.length > 0) {
    bridge.ingest(terminalTail);
  }
}

function mirrorOperationalPublicState(
  engine: SimulationEngine,
  bridge: TruthToPlayerBridge,
  pending: Map<string, PendingClaimVerification>,
  truthDelta: readonly EventEnvelope[],
): void {
  const tick = engine.currentTick;
  const teamIds = new Set<string>();
  let routesTouched = false;
  let resourcesTouched = false;

  for (const event of truthDelta) {
    if (event.kind === "TeamDispatched" || event.kind === "TeamArrived") {
      teamIds.add((event.payload as { teamId: string }).teamId);
    }
    if (event.kind === "CommandAccepted" || event.kind === "CommandRejected") {
      for (const team of engine.worldState.teams) {
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
    const team = engine.worldState.teams.find((item) => item.teamId === teamId);
    if (!team) {
      continue;
    }
    bridge.notifyTeam(tick, toOwnTeam(team));
  }
  if (routesTouched) {
    for (const route of Object.values(engine.worldState.routes)) {
      bridge.notifyRoute(tick, toKnownRoute(route));
    }
  }
  if (resourcesTouched) {
    bridge.notifyResources(tick, {
      backupGenerators: engine.worldState.resources.backupGenerators,
      advisoryUses: engine.worldState.resources.advisoryUses,
    });
  }

  for (const [teamId, job] of [...pending]) {
    const team = engine.worldState.teams.find((item) => item.teamId === teamId);
    const order = team?.order ?? null;
    const stillTheSameWork =
      team !== undefined &&
      order !== null &&
      order.orderId === job.orderId &&
      order.target === job.target &&
      order.task === "verify";
    if (!stillTheSameWork) {
      pending.delete(teamId);
      bridge.clearClaimTarget(teamId);
      continue;
    }
    if (team.status === "working" && team.type === "verification") {
      bridge.resolveVerification({ tick, teamId, claimId: job.claimId });
      pending.delete(teamId);
    }
  }
}

function makeBridge(
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
    type: team.type as OwnTeamState["type"],
    location: team.location as OwnTeamState["location"],
    status: team.status as OwnTeamState["status"],
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

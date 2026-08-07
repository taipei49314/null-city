import { projectPlayerState } from "@null-city/epistemics";
import type { PlayerSessionState } from "@null-city/contracts";
import type { Scenario } from "@null-city/scenario-schema";
import type { SimulationEngine } from "@null-city/simulation";
import type { SessionRecord } from "./hub.js";

/**
 * Legacy helper for engine-only tests. Prefer `publicViewFromRecord` which
 * rebuilds state exclusively from the player event stream.
 */
export function buildPlayerView(engine: SimulationEngine, scenario: Scenario): PlayerSessionState {
  void scenario;
  return {
    stream: "player",
    sessionId: engine.sessionId,
    scenarioId: engine.scenario.id,
    tick: engine.currentTick,
    phase: engine.worldState.phase,
    claims: [],
    evidence: [],
    assessments: [],
    teams: engine.worldState.teams.map((team) => ({
      teamId: team.teamId,
      type: team.type,
      location: team.location,
      status: team.status,
      etaTick: team.etaTick,
      orderTarget: team.order?.target ?? null,
      orderTask: team.order?.task ?? null,
    })),
    routes: Object.values(engine.worldState.routes).map((route) => ({
      id: route.id,
      closed: route.closed,
      knownClosedAtTick: route.closedAtTick,
    })),
    resources: {
      backupGenerators: engine.worldState.resources.backupGenerators,
      advisoryUses: engine.worldState.resources.advisoryUses,
    },
    score: { total: engine.worldState.score.total, recent: [] },
    playerEventCount: 0,
    playerLogHash: "",
  };
}

export function publicViewFromRecord(record: SessionRecord): PlayerSessionState {
  return projectPlayerState(record.bridge.playerEvents);
}

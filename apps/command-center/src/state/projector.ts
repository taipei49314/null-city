import type {
  Assessment,
  Claim,
  Evidence,
  KnownRouteState,
  OwnTeamState,
  PlayerEventEnvelope,
  PlayerSessionState,
  PublicResources,
} from "@null-city/contracts";

/**
 * Client-owned projection from the public player event stream to
 * `PlayerSessionState`. This is a clean-room re-implementation scoped to the
 * command center — it never imports the simulation/truth package, and it
 * never reads anything the player was not sent. The
 * server independently computes the same projection and returns it on every
 * REST response; this module lets the browser rebuild identical state from
 * the raw event stream alone (e.g. when only WS deltas arrive), and keeps
 * the browser honest about what "known" actually means.
 */
export function emptyPlayerState(sessionId: string, scenarioId = ""): PlayerSessionState {
  return {
    stream: "player",
    sessionId,
    scenarioId,
    tick: 0,
    phase: "running",
    claims: [],
    evidence: [],
    assessments: [],
    teams: [],
    routes: [],
    resources: { backupGenerators: 0, advisoryUses: 0 },
    score: { total: 0, recent: [] },
    playerEventCount: 0,
    playerLogHash: "",
  };
}

export function applyPlayerEvent(state: PlayerSessionState, event: PlayerEventEnvelope): PlayerSessionState {
  const next: PlayerSessionState = {
    ...state,
    tick: event.tick,
    claims: [...state.claims],
    evidence: [...state.evidence],
    assessments: [...state.assessments],
    teams: [...state.teams],
    routes: [...state.routes],
    resources: { ...state.resources },
    score: { total: state.score.total, recent: [...state.score.recent] },
    playerEventCount: state.playerEventCount + 1,
    playerLogHash: event.hash,
  };

  switch (event.kind) {
    case "SessionStarted": {
      const payload = event.payload as {
        scenarioId: string;
        teams: OwnTeamState[];
        routes: KnownRouteState[];
        resources: PublicResources;
      };
      next.scenarioId = payload.scenarioId;
      next.sessionId = event.sessionId;
      next.teams = payload.teams.map((team) => ({ ...team }));
      next.routes = payload.routes.map((route) => ({ ...route }));
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
      next.claims = next.claims.map((claim) => {
        if (claim.id !== payload.claimId) {
          return claim;
        }
        if (payload.outcome === "inconclusive") {
          return { ...claim, lastUpdatedTick: event.tick, asOfTick: event.tick };
        }
        return { ...claim, status: payload.outcome, lastUpdatedTick: event.tick, asOfTick: event.tick };
      });
      next.evidence = next.evidence.map((item) =>
        item.claimId === payload.claimId && payload.outcome === "verified" ? { ...item, verified: true } : item,
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
      next.score.recent = [
        ...next.score.recent.slice(-19),
        { category: payload.category, delta: payload.delta, reason: payload.reason, tick: event.tick },
      ];
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
    case "CommandResult":
    default:
      break;
  }
  return next;
}

export function projectPlayerState(events: readonly PlayerEventEnvelope[]): PlayerSessionState {
  let state = emptyPlayerState(events[0]?.sessionId ?? "");
  for (const event of events) {
    state = applyPlayerEvent(state, event);
  }
  return state;
}

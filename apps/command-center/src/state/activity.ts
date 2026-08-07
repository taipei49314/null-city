import type {
  Assessment,
  Claim,
  CommandResultPayload,
  Evidence,
  PlayerEventEnvelope,
} from "@null-city/contracts";
import { districtLabel } from "../topology/registry";

export interface ActivityEntry {
  id: string;
  sequence: number;
  tick: number;
  kind: PlayerEventEnvelope["kind"];
  summary: string;
}

/**
 * Renders a short human-readable summary for the chronological activity /
 * evidence timeline. Pure and presentation-only — it never invents facts
 * beyond what the event payload already contains.
 */
export function describeEvent(event: PlayerEventEnvelope): ActivityEntry {
  const base = { id: `${event.sequence}`, sequence: event.sequence, tick: event.tick, kind: event.kind };
  switch (event.kind) {
    case "SessionStarted":
      return { ...base, summary: "Session started." };
    case "EvidenceRecorded": {
      const evidence = (event.payload as { evidence: Evidence }).evidence;
      return { ...base, summary: `Evidence from ${evidence.sourceId}: "${evidence.content}"` };
    }
    case "ClaimUpdated": {
      const payload = event.payload as { claim: Claim; reason: string };
      const where = payload.claim.districtId ? ` in ${districtLabel(payload.claim.districtId)}` : "";
      return {
        ...base,
        summary: `Claim ${payload.reason}${where}: ${payload.claim.subject} ${payload.claim.predicate}`,
      };
    }
    case "AssessmentSubmitted": {
      const assessment = (event.payload as { assessment: Assessment }).assessment;
      return {
        ...base,
        summary: `Assessment submitted: p=${assessment.probability.toFixed(2)} conf=${assessment.confidence.toFixed(2)}`,
      };
    }
    case "VerificationResolved": {
      const payload = event.payload as { claimId: string; outcome: string; teamId: string };
      return { ...base, summary: `Verification ${payload.outcome} by ${payload.teamId} for claim ${payload.claimId}` };
    }
    case "CommandResult": {
      const payload = event.payload as CommandResultPayload;
      const detail = payload.detail ? ` — ${payload.detail}` : "";
      return { ...base, summary: `Command ${payload.commandName} ${payload.state}${detail}` };
    }
    case "OwnTeamUpdated": {
      const payload = event.payload as { team: { teamId: string; status: string; location: string } };
      return {
        ...base,
        summary: `Team ${payload.team.teamId} is ${payload.team.status} at ${districtLabel(payload.team.location)}`,
      };
    }
    case "KnownRouteUpdated": {
      const payload = event.payload as { route: { id: string; closed: boolean } };
      return { ...base, summary: `Route ${payload.route.id} is now ${payload.route.closed ? "closed" : "open"}` };
    }
    case "PublicScoreChanged": {
      const payload = event.payload as { delta: number; reason: string; total: number };
      const sign = payload.delta >= 0 ? "+" : "";
      return { ...base, summary: `Score ${sign}${payload.delta.toFixed(1)} (${payload.reason}) → total ${payload.total.toFixed(1)}` };
    }
    case "ResourcesChanged":
      return { ...base, summary: "Resources updated." };
    case "RunCompleted": {
      const payload = event.payload as { finalTick: number; scoreTotal: number };
      return { ...base, summary: `Run completed at tick ${payload.finalTick}, score ${payload.scoreTotal.toFixed(1)}` };
    }
    default:
      return { ...base, summary: event.kind };
  }
}

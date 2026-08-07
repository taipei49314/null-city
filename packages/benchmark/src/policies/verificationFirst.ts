import type { Claim } from "@null-city/contracts";
import type { AssessmentRequest, CommandRequest } from "@null-city/sdk";

import type { Policy, PolicyContext, PolicyDecision, PolicyInput } from "../policy.js";
import { isIdle, taskFor } from "./teams.js";

const UNRESOLVED_STATUSES = new Set(["reported", "corroborated", "contested"]);
const RESOLVED_STATUSES = new Set(["verified", "refuted", "stale"]);

/** Deterministic prior probability per claim status — no randomness. */
function priorProbability(status: Claim["status"]): number {
  switch (status) {
    case "corroborated":
      return 0.75;
    case "contested":
      return 0.35;
    case "verified":
      return 0.95;
    case "refuted":
      return 0.05;
    default:
      return 0.5;
  }
}

function byUrgency(a: Claim, b: Claim): number {
  if (a.firstObservedTick !== b.firstObservedTick) {
    return a.firstObservedTick - b.firstObservedTick;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Prioritizes verification over raw dispatch: every idle verification
 * team is sent at the oldest contested-then-reported claim that has not
 * already had a verification requested; every claim gets exactly one
 * assessment the first time it is observed (never re-submitted, so a
 * long-running claim doesn't spam duplicate assessments). Remaining idle
 * non-verification teams fall back to the same greedy dispatch as
 * `reactive-greedy`. All decisions are functions of public state plus
 * this policy's own bookkeeping (which claims were already assessed or
 * had verification requested) — never truth.
 */
export function createVerificationFirstPolicy(): Policy {
  let assessedClaimIds: Set<string>;
  let verificationRequestedClaimIds: Set<string>;

  return {
    id: "verification-first",
    async reset(context: PolicyContext): Promise<void> {
      void context;
      assessedClaimIds = new Set();
      verificationRequestedClaimIds = new Set();
    },
    async decide(input: PolicyInput): Promise<PolicyDecision> {
      const commands: CommandRequest[] = [];
      const assessments: AssessmentRequest[] = [];
      const targetedDistricts = new Set<string>();

      for (const claim of input.state.claims) {
        if (assessedClaimIds.has(claim.id)) {
          continue;
        }
        if (UNRESOLVED_STATUSES.has(claim.status) || RESOLVED_STATUSES.has(claim.status)) {
          assessments.push({
            claimId: claim.id,
            probability: priorProbability(claim.status),
            confidence: 0.5,
            rationale: `verification-first prior for status=${claim.status}`,
          });
          assessedClaimIds.add(claim.id);
        }
      }

      const contestedFirst = input.state.claims
        .filter(
          (claim) =>
            claim.districtId !== undefined &&
            UNRESOLVED_STATUSES.has(claim.status) &&
            !verificationRequestedClaimIds.has(claim.id),
        )
        .slice()
        .sort((a, b) => {
          const aContested = a.status === "contested" ? 0 : 1;
          const bContested = b.status === "contested" ? 0 : 1;
          if (aContested !== bContested) {
            return aContested - bContested;
          }
          return byUrgency(a, b);
        });

      const idleVerificationTeams = input.state.teams
        .filter((team) => isIdle(team) && team.type === "verification")
        .slice()
        .sort((a, b) => a.teamId.localeCompare(b.teamId));

      for (const team of idleVerificationTeams) {
        const claim = contestedFirst.find((c) => c.districtId !== undefined && !targetedDistricts.has(c.districtId));
        if (!claim || claim.districtId === undefined) {
          continue;
        }
        targetedDistricts.add(claim.districtId);
        verificationRequestedClaimIds.add(claim.id);
        commands.push({
          commandName: "REQUEST_VERIFICATION",
          // Public contract is claim-targeted; the server derives district.
          params: { teamId: team.teamId, claimId: claim.id },
        });
      }

      const unresolvedForDispatch = input.state.claims
        .filter((claim) => claim.districtId !== undefined && UNRESOLVED_STATUSES.has(claim.status))
        .slice()
        .sort(byUrgency);

      const idleWorkTeams = input.state.teams
        .filter((team) => isIdle(team) && team.type !== "verification")
        .slice()
        .sort((a, b) => a.teamId.localeCompare(b.teamId));

      for (const team of idleWorkTeams) {
        const task = taskFor(team);
        if (!task) {
          continue;
        }
        const claim = unresolvedForDispatch.find((c) => c.districtId !== undefined && !targetedDistricts.has(c.districtId));
        if (!claim || claim.districtId === undefined) {
          continue;
        }
        targetedDistricts.add(claim.districtId);
        commands.push({
          commandName: "DISPATCH_TEAM",
          params: { teamId: team.teamId, target: claim.districtId, task },
        });
      }

      return { commands, assessments };
    },
  };
}

import type { Claim } from "@null-city/contracts";
import type { CommandRequest } from "@null-city/sdk";

import type { Policy, PolicyContext, PolicyDecision, PolicyInput } from "../policy.js";
import { isIdle, taskFor } from "./teams.js";

const UNRESOLVED_STATUSES = new Set(["reported", "corroborated", "contested"]);

function byUrgency(a: Claim, b: Claim): number {
  if (a.firstObservedTick !== b.firstObservedTick) {
    return a.firstObservedTick - b.firstObservedTick;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Dispatches every idle, non-verification team to the oldest unresolved
 * claim in a district no other team is already being sent to this tick.
 * Purely a function of `PlayerSessionState` — no memory across ticks, no
 * randomness, deterministic given the same state.
 */
export function createReactiveGreedyPolicy(): Policy {
  return {
    id: "reactive-greedy",
    async reset(context: PolicyContext): Promise<void> {
      void context; // stateless
    },
    async decide(input: PolicyInput): Promise<PolicyDecision> {
      const commands: CommandRequest[] = [];
      const targetedDistricts = new Set<string>();
      const unresolvedClaims = input.state.claims
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
        const claim = unresolvedClaims.find((c) => c.districtId !== undefined && !targetedDistricts.has(c.districtId));
        if (!claim || claim.districtId === undefined) {
          continue;
        }
        targetedDistricts.add(claim.districtId);
        commands.push({
          commandName: "DISPATCH_TEAM",
          params: { teamId: team.teamId, target: claim.districtId, task },
        });
      }

      return { commands, assessments: [] };
    },
  };
}

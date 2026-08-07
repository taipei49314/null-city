import type { OwnTeamState } from "@null-city/contracts";

/**
 * Default response task per team type — mirrors
 * `TASK_COMPATIBILITY` in `packages/simulation/src/engine.ts`, but derived
 * only from the public `team.type` string, never from truth. Scenario-
 * agnostic: it makes no assumption about specific team ids or district
 * layouts, so it works on any scenario that reuses these team types.
 */
export const DEFAULT_TASK_BY_TEAM_TYPE: Record<string, string> = {
  power: "power_repair",
  fire: "hazard_control",
  medical: "medical_support",
  communications: "comms_repair",
  verification: "verify",
};

export function isIdle(team: OwnTeamState): boolean {
  return team.status === "idle";
}

export function taskFor(team: OwnTeamState): string | null {
  return DEFAULT_TASK_BY_TEAM_TYPE[team.type] ?? null;
}

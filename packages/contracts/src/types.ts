/**
 * Shared vocabulary that is safe on both sides of the epistemic boundary.
 *
 * The simulation keeps one "truth" world state that the player can never
 * read directly. Everything the player knows arrives through the
 * observation pipeline. The truth world-state types themselves live in
 * `truth-state.ts` and are only reachable via `@null-city/contracts/truth`.
 */

import type { DistrictId, RouteId } from "./ids.js";

export type { DistrictId, RouteId };
/**
 * `Black River`'s specific district set — kept only as a documented
 * reference/example for scenario authors. It is **not** used to restrict
 * `DistrictId` (see `ids.ts`) or scenario validation: `@null-city/scenario-schema`
 * accepts any scenario-defined district id and checks references
 * structurally against that scenario's own district list.
 */
export const DISTRICT_IDS = ["central", "industrial", "riverside", "north", "medical"] as const;

export const TEAM_TYPES = ["power", "fire", "medical", "communications", "verification"] as const;
export type TeamType = (typeof TEAM_TYPES)[number];

export const TEAM_LABELS: Record<TeamType, string> = {
  power: "Power Repair",
  fire: "Fire / Hazard",
  medical: "Medical",
  communications: "Communications Repair",
  verification: "On-Site Verification",
};

export const COMMAND_NAMES = [
  "DISPATCH_TEAM",
  "REROUTE_POWER",
  "ACTIVATE_BACKUP_GENERATOR",
  "CLOSE_ROUTE",
  "REOPEN_ROUTE",
  "REQUEST_VERIFICATION",
  "INSPECT_DISTRICT",
  "ISSUE_PUBLIC_ADVISORY",
  "PRIORITIZE_COMMUNICATION",
  "CANCEL_ORDER",
] as const;

export type Tick = number;

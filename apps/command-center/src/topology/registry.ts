/**
 * Registry over the local, structural-only topology modules for every
 * scenario in the suite. See `blackRiver.ts` for why this data is
 * hardcoded here rather than derived from the scenario source or any
 * truth package.
 *
 * Adding a new scenario to the suite means adding one topology module
 * (districts + routes + layout) and one entry here — never touching the
 * simulation, contracts, or server packages.
 */
import { BLACK_RIVER_SCENARIO_ID, BLACK_RIVER_TOPOLOGY } from "./blackRiver";
import { GLASS_HARBOR_SCENARIO_ID, GLASS_HARBOR_TOPOLOGY } from "./glassHarbor";
import { MIRROR_DISTRICT_SCENARIO_ID, MIRROR_DISTRICT_TOPOLOGY } from "./mirrorDistrict";
import { RED_LEDGER_SCENARIO_ID, RED_LEDGER_TOPOLOGY } from "./redLedger";
import { SIGNAL_ZERO_SCENARIO_ID, SIGNAL_ZERO_TOPOLOGY } from "./signalZero";
import type { ScenarioTopology, TopologyDistrict } from "./types";

export type { ScenarioTopology, TopologyDistrict, TopologyRoute } from "./types";
export {
  BLACK_RIVER_SCENARIO_ID,
  GLASS_HARBOR_SCENARIO_ID,
  MIRROR_DISTRICT_SCENARIO_ID,
  RED_LEDGER_SCENARIO_ID,
  SIGNAL_ZERO_SCENARIO_ID,
};

export const DEFAULT_SCENARIO_ID = BLACK_RIVER_SCENARIO_ID;

/** Every scenario's topology, in launch-picker display order. */
export const SCENARIO_TOPOLOGIES: readonly ScenarioTopology[] = [
  BLACK_RIVER_TOPOLOGY,
  GLASS_HARBOR_TOPOLOGY,
  SIGNAL_ZERO_TOPOLOGY,
  MIRROR_DISTRICT_TOPOLOGY,
  RED_LEDGER_TOPOLOGY,
];

const TOPOLOGY_BY_SCENARIO_ID = new Map<string, ScenarioTopology>(
  SCENARIO_TOPOLOGIES.map((topology) => [topology.scenarioId, topology]),
);

/** Falls back to Black River's topology for an unrecognized scenario id (defensive only). */
export function getTopology(scenarioId: string): ScenarioTopology {
  return TOPOLOGY_BY_SCENARIO_ID.get(scenarioId) ?? BLACK_RIVER_TOPOLOGY;
}

/** Every known district across every scenario, for label lookups that don't have a scenario id at hand. */
const ALL_DISTRICTS: readonly TopologyDistrict[] = SCENARIO_TOPOLOGIES.flatMap((topology) => topology.districts);
const DISTRICT_BY_ID = new Map<string, TopologyDistrict>(ALL_DISTRICTS.map((district) => [district.id, district]));

export function findDistrict(id: string): TopologyDistrict | undefined {
  return DISTRICT_BY_ID.get(id);
}

export function districtLabel(id: string): string {
  return findDistrict(id)?.label ?? id;
}

/**
 * Display labels for team types. Duplicated locally (matches
 * `@null-city/contracts` `TEAM_LABELS`) rather than importing it, because
 * `@null-city/contracts`'s single barrel entry point also re-exports
 * `canonical.ts` (Node's `node:crypto`), which is not browser-safe. Taking
 * only `import type` from that package everywhere else keeps this bundle
 * free of any runtime dependency on it.
 */
export const TEAM_TYPE_LABELS: Record<string, string> = {
  power: "Power Repair",
  fire: "Fire / Hazard",
  medical: "Medical",
  communications: "Communications Repair",
  verification: "On-Site Verification",
};

export const TEAM_TYPE_INITIAL: Record<string, string> = {
  power: "P",
  fire: "F",
  medical: "M",
  communications: "C",
  verification: "V",
};

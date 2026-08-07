/**
 * Local topology module for the Glass Harbor scenario.
 *
 * Structural facts only (districts + connecting roads + layout position),
 * hardcoded here rather than derived from the scenario source — see the
 * note in `blackRiver.ts`. Harborside sits at the tip of the peninsula;
 * Ferry District is the single chokepoint everything else must pass
 * through, except for the slower Harborside–Old Town bypass route.
 */
import type { ScenarioTopology } from "./types";

export const GLASS_HARBOR_SCENARIO_ID = "glass-harbor";

const GLASS_HARBOR_DISTRICTS = [
  { id: "harborside", label: "Harborside", x: 85, y: 50 },
  { id: "ferry-district", label: "Ferry District", x: 60, y: 50 },
  { id: "old-town", label: "Old Town", x: 35, y: 30 },
  { id: "uplands", label: "Uplands", x: 20, y: 55 },
  { id: "clinic-row", label: "Clinic Row", x: 35, y: 80 },
] as const;

const GLASS_HARBOR_ROUTES = [
  { id: "harborside-ferry", from: "harborside", to: "ferry-district" },
  { id: "ferry-oldtown", from: "ferry-district", to: "old-town" },
  { id: "ferry-clinic", from: "ferry-district", to: "clinic-row" },
  { id: "oldtown-uplands", from: "old-town", to: "uplands" },
  { id: "uplands-clinic", from: "uplands", to: "clinic-row" },
  { id: "harborside-oldtown", from: "harborside", to: "old-town" },
] as const;

export const GLASS_HARBOR_TOPOLOGY: ScenarioTopology = {
  scenarioId: GLASS_HARBOR_SCENARIO_ID,
  name: "GLASS HARBOR",
  districts: GLASS_HARBOR_DISTRICTS,
  routes: GLASS_HARBOR_ROUTES,
};

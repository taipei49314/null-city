/**
 * Local topology for Mirror District — twin yards flanking a bridge chokepoint.
 * Structural facts only; no truth attributes.
 */
import type { ScenarioTopology } from "./types";

export const MIRROR_DISTRICT_SCENARIO_ID = "mirror-district";

const MIRROR_DISTRICT_DISTRICTS = [
  { id: "north-mirror", label: "North Mirror", x: 28, y: 28 },
  { id: "south-mirror", label: "South Mirror", x: 28, y: 78 },
  { id: "mirror-bridge", label: "Mirror Bridge", x: 52, y: 52 },
  { id: "clinic-hub", label: "Clinic Hub", x: 78, y: 52 },
  { id: "archive-yard", label: "Archive Yard", x: 78, y: 22 },
] as const;

const MIRROR_DISTRICT_ROUTES = [
  { id: "north-bridge", from: "north-mirror", to: "mirror-bridge" },
  { id: "south-bridge", from: "south-mirror", to: "mirror-bridge" },
  { id: "bridge-clinic", from: "mirror-bridge", to: "clinic-hub" },
  { id: "clinic-archive", from: "clinic-hub", to: "archive-yard" },
  { id: "north-archive", from: "north-mirror", to: "archive-yard" },
  { id: "south-archive", from: "south-mirror", to: "archive-yard" },
] as const;

export const MIRROR_DISTRICT_TOPOLOGY: ScenarioTopology = {
  scenarioId: MIRROR_DISTRICT_SCENARIO_ID,
  name: "MIRROR DISTRICT",
  districts: MIRROR_DISTRICT_DISTRICTS,
  routes: MIRROR_DISTRICT_ROUTES,
};

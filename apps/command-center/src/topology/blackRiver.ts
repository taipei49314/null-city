/**
 * Local topology module for the Black River scenario.
 *
 * This is intentionally NOT loaded from the scenario source or any truth
 * package. It hardcodes only the *structural* public facts that a human
 * commander would already know before the crisis starts: which districts
 * exist and which roads connect them. It carries no district attribute
 * values (power, hazard, population risk, ...) — those are only ever known
 * through delivered evidence and claims in `PlayerSessionState`, never from
 * this module. Rendering position (x/y) is a presentation concern only.
 */
import type { ScenarioTopology } from "./types";

export const BLACK_RIVER_SCENARIO_ID = "black-river";

const BLACK_RIVER_DISTRICTS = [
  { id: "central", label: "Central", x: 50, y: 50 },
  { id: "industrial", label: "Industrial", x: 82, y: 30 },
  { id: "riverside", label: "Riverside", x: 78, y: 78 },
  { id: "north", label: "North", x: 30, y: 18 },
  { id: "medical", label: "Medical", x: 16, y: 70 },
] as const;

const BLACK_RIVER_ROUTES = [
  { id: "central-industrial", from: "central", to: "industrial" },
  { id: "central-riverside", from: "central", to: "riverside" },
  { id: "central-north", from: "central", to: "north" },
  { id: "central-medical", from: "central", to: "medical" },
  { id: "north-medical", from: "north", to: "medical" },
  { id: "north-riverside", from: "north", to: "riverside" },
  { id: "industrial-riverside", from: "industrial", to: "riverside" },
] as const;

export const BLACK_RIVER_TOPOLOGY: ScenarioTopology = {
  scenarioId: BLACK_RIVER_SCENARIO_ID,
  name: "BLACK RIVER",
  districts: BLACK_RIVER_DISTRICTS,
  routes: BLACK_RIVER_ROUTES,
};

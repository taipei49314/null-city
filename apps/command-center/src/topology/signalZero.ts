/**
 * Local topology module for the Signal Zero scenario.
 *
 * Structural facts only (districts + connecting roads + layout position),
 * hardcoded here rather than derived from the scenario source — see the
 * note in `blackRiver.ts`. Civic Center is the communications hub; East
 * Relay and West Relay are the two relay stations the comms jam and its
 * cascade move between.
 */
import type { ScenarioTopology } from "./types";

export const SIGNAL_ZERO_SCENARIO_ID = "signal-zero";

const SIGNAL_ZERO_DISTRICTS = [
  { id: "civic-center", label: "Civic Center", x: 50, y: 50 },
  { id: "uptown-grid", label: "Uptown Grid", x: 50, y: 20 },
  { id: "lowline", label: "Lowline", x: 30, y: 75 },
  { id: "east-relay", label: "East Relay", x: 82, y: 30 },
  { id: "west-relay", label: "West Relay", x: 75, y: 75 },
] as const;

const SIGNAL_ZERO_ROUTES = [
  { id: "civic-uptown", from: "civic-center", to: "uptown-grid" },
  { id: "civic-lowline", from: "civic-center", to: "lowline" },
  { id: "civic-eastrelay", from: "civic-center", to: "east-relay" },
  { id: "eastrelay-westrelay", from: "east-relay", to: "west-relay" },
  { id: "uptown-eastrelay", from: "uptown-grid", to: "east-relay" },
  { id: "lowline-westrelay", from: "lowline", to: "west-relay" },
] as const;

export const SIGNAL_ZERO_TOPOLOGY: ScenarioTopology = {
  scenarioId: SIGNAL_ZERO_SCENARIO_ID,
  name: "SIGNAL ZERO",
  districts: SIGNAL_ZERO_DISTRICTS,
  routes: SIGNAL_ZERO_ROUTES,
};

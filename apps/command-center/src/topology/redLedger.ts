/**
 * Local topology for Red Ledger — civic hall, ration yard, twin wards, clinic.
 * Structure only; no truth attributes.
 */
import type { ScenarioTopology } from "./types";

export const RED_LEDGER_SCENARIO_ID = "red-ledger";

const RED_LEDGER_DISTRICTS = [
  { id: "ledger-hall", label: "Ledger Hall", x: 50, y: 22 },
  { id: "ration-yard", label: "Ration Yard", x: 50, y: 48 },
  { id: "north-wards", label: "North Wards", x: 22, y: 72 },
  { id: "south-wards", label: "South Wards", x: 78, y: 72 },
  { id: "mercy-clinic", label: "Mercy Clinic", x: 50, y: 88 },
] as const;

const RED_LEDGER_ROUTES = [
  { id: "hall-yard", from: "ledger-hall", to: "ration-yard" },
  { id: "yard-north", from: "ration-yard", to: "north-wards" },
  { id: "yard-south", from: "ration-yard", to: "south-wards" },
  { id: "north-clinic", from: "north-wards", to: "mercy-clinic" },
  { id: "south-clinic", from: "south-wards", to: "mercy-clinic" },
  { id: "hall-clinic", from: "ledger-hall", to: "mercy-clinic" },
  { id: "north-south", from: "north-wards", to: "south-wards" },
] as const;

export const RED_LEDGER_TOPOLOGY: ScenarioTopology = {
  scenarioId: RED_LEDGER_SCENARIO_ID,
  name: "RED LEDGER",
  districts: RED_LEDGER_DISTRICTS,
  routes: RED_LEDGER_ROUTES,
};

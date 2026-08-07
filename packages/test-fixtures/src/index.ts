import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assertScenarioSize, parseScenario, type Scenario } from "@null-city/scenario-schema";
import type { CommandName } from "@null-city/contracts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function loadScenario(name: string): Scenario {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`invalid scenario name ${JSON.stringify(name)}; only [a-z0-9-] allowed`);
  }
  const json = readFileSync(join(REPO_ROOT, "scenarios", `${name}.json`), { encoding: "utf8" });
  assertScenarioSize(json);
  return parseScenario(json);
}

export const blackRiver = (): Scenario => loadScenario("black-river");
export const glassHarbor = (): Scenario => loadScenario("glass-harbor");
export const signalZero = (): Scenario => loadScenario("signal-zero");
export const mirrorDistrict = (): Scenario => loadScenario("mirror-district");
export const redLedger = (): Scenario => loadScenario("red-ledger");

export interface ScriptedCommand {
  atTick: number;
  commandName: CommandName;
  params: Record<string, unknown>;
  idempotencyKey: string;
}

/** no player action at all — the neglect/failure path */
export const failureScript = (): ScriptedCommand[] => [];

/**
 * A defensible player script for BLACK RIVER:
 * - repairs the substation and hospital immediately
 * - protects the pumping station with a backup generator
 * - sends a water-restore team to Riverside
 * - dispatches the verification team to Industrial
 * - prioritises Industrial communications
 * - never closes the North Bridge, never broadcasts harmful advisories
 */
export const goldenScript = (): ScriptedCommand[] => [
  { atTick: 12, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "industrial", task: "power_repair" }, idempotencyKey: "golden-01" },
  { atTick: 12, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "industrial", task: "hazard_control" }, idempotencyKey: "golden-02" },
  { atTick: 15, commandName: "DISPATCH_TEAM", params: { teamId: "power-2", target: "medical", task: "power_repair" }, idempotencyKey: "golden-03" },
  { atTick: 16, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "industrial", ticks: 120 }, idempotencyKey: "golden-04" },
  { atTick: 30, commandName: "ACTIVATE_BACKUP_GENERATOR", params: { district: "riverside" }, idempotencyKey: "golden-05" },
  { atTick: 40, commandName: "DISPATCH_TEAM", params: { teamId: "fire-2", target: "riverside", task: "water_restore" }, idempotencyKey: "golden-06" },
  { atTick: 45, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "riverside", task: "power_repair" }, idempotencyKey: "golden-07" },
  { atTick: 60, commandName: "REQUEST_VERIFICATION", params: { target: "industrial", teamId: "verify-1" }, idempotencyKey: "golden-08" },
  { atTick: 80, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "industrial", task: "comms_repair" }, idempotencyKey: "golden-09" },
];

/**
 * A defensible player script for GLASS HARBOR:
 * - contains the hazmat leak at its source with both fire teams
 * - prioritises Harborside communications so the true-origin dispatch
 *   confirmation outruns the false-attribution news report
 * - sends the verification team to Harborside (the incident's true
 *   district) rather than Clinic Row, the district the corrupted news
 *   report falsely blames
 * - stages medical support at Old Town and Clinic Row ahead of the
 *   plume-drift / clinic-overload cascade
 * - never issues an evacuation advisory for Old Town, whose real
 *   hazardLevel stays low even though citizen reports exaggerate it
 */
export const glassHarborGoldenScript = (): ScriptedCommand[] => [
  { atTick: 10, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "harborside", task: "hazard_control" }, idempotencyKey: "gh-golden-01" },
  { atTick: 10, commandName: "DISPATCH_TEAM", params: { teamId: "fire-2", target: "harborside", task: "hazard_control" }, idempotencyKey: "gh-golden-02" },
  { atTick: 12, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "harborside", ticks: 120 }, idempotencyKey: "gh-golden-03" },
  { atTick: 20, commandName: "REQUEST_VERIFICATION", params: { target: "harborside", teamId: "verify-1" }, idempotencyKey: "gh-golden-04" },
  { atTick: 25, commandName: "DISPATCH_TEAM", params: { teamId: "med-2", target: "old-town", task: "medical_support" }, idempotencyKey: "gh-golden-05" },
  { atTick: 30, commandName: "DISPATCH_TEAM", params: { teamId: "med-1", target: "clinic-row", task: "medical_support" }, idempotencyKey: "gh-golden-06" },
  { atTick: 40, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "harborside", task: "power_repair" }, idempotencyKey: "gh-golden-07" },
  { atTick: 60, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "harborside", task: "comms_repair" }, idempotencyKey: "gh-golden-08" },
];

/**
 * A defensible player script for SIGNAL ZERO:
 * - protects East Relay power ahead of the jam, then repairs comms there
 *   immediately at the source
 * - prioritises East Relay communications so the legitimate telemetry and
 *   dispatch confirmation outrun the spoofed "all clear" feed
 * - preemptively reinforces West Relay comms before the jam can chain
 * - sends a verification team on-site to both East Relay (to settle the
 *   contradictory dispatch reports) and Lowline (to debunk the spoofed
 *   gas-alarm claim, the only handler `spoof_alert` accepts)
 */
export const signalZeroGoldenScript = (): ScriptedCommand[] => [
  { atTick: 5, commandName: "ACTIVATE_BACKUP_GENERATOR", params: { district: "east-relay" }, idempotencyKey: "sz-golden-01" },
  { atTick: 8, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "east-relay", task: "comms_repair" }, idempotencyKey: "sz-golden-02" },
  { atTick: 8, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "east-relay", ticks: 150 }, idempotencyKey: "sz-golden-03" },
  { atTick: 12, commandName: "DISPATCH_TEAM", params: { teamId: "comms-2", target: "west-relay", task: "comms_repair" }, idempotencyKey: "sz-golden-04" },
  { atTick: 15, commandName: "REQUEST_VERIFICATION", params: { target: "east-relay", teamId: "verify-1" }, idempotencyKey: "sz-golden-05" },
  { atTick: 20, commandName: "REQUEST_VERIFICATION", params: { target: "lowline", teamId: "verify-2" }, idempotencyKey: "sz-golden-06" },
];

/**
 * Defensible script for MIRROR DISTRICT:
 * - verify BOTH twins before committing fire/medical
 * - contain the real North spill only after verification begins
 * - stage clinic support after the true source is engaged
 * - never evacuate South Mirror on the spoofed all-clear
 */
export const mirrorDistrictGoldenScript = (): ScriptedCommand[] => [
  { atTick: 10, commandName: "REQUEST_VERIFICATION", params: { target: "north-mirror", teamId: "verify-1" }, idempotencyKey: "md-golden-01" },
  { atTick: 10, commandName: "REQUEST_VERIFICATION", params: { target: "south-mirror", teamId: "verify-2" }, idempotencyKey: "md-golden-02" },
  { atTick: 12, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "north-mirror", ticks: 120 }, idempotencyKey: "md-golden-03" },
  { atTick: 18, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "north-mirror", task: "hazard_control" }, idempotencyKey: "md-golden-04" },
  { atTick: 20, commandName: "DISPATCH_TEAM", params: { teamId: "fire-2", target: "north-mirror", task: "hazard_control" }, idempotencyKey: "md-golden-05" },
  { atTick: 28, commandName: "DISPATCH_TEAM", params: { teamId: "med-1", target: "clinic-hub", task: "medical_support" }, idempotencyKey: "md-golden-06" },
  { atTick: 35, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "north-mirror", task: "comms_repair" }, idempotencyKey: "md-golden-07" },
  { atTick: 40, commandName: "DISPATCH_TEAM", params: { teamId: "med-2", target: "mirror-bridge", task: "medical_support" }, idempotencyKey: "md-golden-08" },
];

/**
 * Defensible script for RED LEDGER:
 * - verify both wards before trusting census/news
 * - restore ration-yard water immediately (cascade root)
 * - generator + power repair for North Wards shelters
 * - stage medical at Mercy Clinic
 * - never issue a South Wards evacuation advisory
 */
export const redLedgerGoldenScript = (): ScriptedCommand[] => [
  { atTick: 10, commandName: "REQUEST_VERIFICATION", params: { target: "north-wards", teamId: "verify-1" }, idempotencyKey: "rl-golden-01" },
  { atTick: 10, commandName: "REQUEST_VERIFICATION", params: { target: "south-wards", teamId: "verify-2" }, idempotencyKey: "rl-golden-02" },
  { atTick: 12, commandName: "DISPATCH_TEAM", params: { teamId: "fire-1", target: "ration-yard", task: "water_restore" }, idempotencyKey: "rl-golden-03" },
  { atTick: 14, commandName: "PRIORITIZE_COMMUNICATION", params: { district: "ration-yard", ticks: 120 }, idempotencyKey: "rl-golden-04" },
  { atTick: 18, commandName: "ACTIVATE_BACKUP_GENERATOR", params: { district: "north-wards" }, idempotencyKey: "rl-golden-05" },
  { atTick: 20, commandName: "DISPATCH_TEAM", params: { teamId: "power-1", target: "north-wards", task: "power_repair" }, idempotencyKey: "rl-golden-06" },
  { atTick: 25, commandName: "DISPATCH_TEAM", params: { teamId: "power-2", target: "ration-yard", task: "power_repair" }, idempotencyKey: "rl-golden-07" },
  { atTick: 30, commandName: "DISPATCH_TEAM", params: { teamId: "med-1", target: "mercy-clinic", task: "medical_support" }, idempotencyKey: "rl-golden-08" },
  { atTick: 40, commandName: "DISPATCH_TEAM", params: { teamId: "comms-1", target: "ledger-hall", task: "comms_repair" }, idempotencyKey: "rl-golden-09" },
];

/** Every scenario id served by `loadScenario`, and its matching golden script. */
export const SCENARIO_IDS = [
  "black-river",
  "glass-harbor",
  "signal-zero",
  "mirror-district",
  "red-ledger",
] as const;
export type SuiteScenarioId = (typeof SCENARIO_IDS)[number];

export function goldenScriptFor(scenarioId: SuiteScenarioId): ScriptedCommand[] {
  switch (scenarioId) {
    case "black-river":
      return goldenScript();
    case "glass-harbor":
      return glassHarborGoldenScript();
    case "signal-zero":
      return signalZeroGoldenScript();
    case "mirror-district":
      return mirrorDistrictGoldenScript();
    case "red-ledger":
      return redLedgerGoldenScript();
    default: {
      const _exhaustive: never = scenarioId;
      throw new Error(`no golden script for scenario ${_exhaustive as string}`);
    }
  }
}

/**
 * Runs a scripted command list against a fresh engine.
 * Advances the engine to each command's tick before submitting it.
 */
export function runScript(engine: {
  currentTick: number;
  step(): boolean;
  submitCommand(name: CommandName, params: Record<string, unknown>, key: string): unknown;
}, script: ScriptedCommand[]): void {
  let cursor = 0;
  while (cursor < script.length) {
    const command = script[cursor]!;
    if (command.atTick <= engine.currentTick) {
      engine.submitCommand(command.commandName, command.params, command.idempotencyKey);
      cursor += 1;
      continue;
    }
    if (!engine.step()) {
      return;
    }
  }
}
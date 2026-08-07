import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertScenarioSize, parseScenario, type Scenario } from "@null-city/scenario-schema";

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Loads a scenario from the repo-level scenarios/ directory.
 * The name is strictly validated to prevent path traversal.
 */
export function loadScenarioByName(name: string, scenariosDir: string): Scenario {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`invalid scenario name ${JSON.stringify(name)}; only [a-z0-9-] allowed`);
  }
  const path = join(scenariosDir, `${name}.json`);
  const json = readFileSync(path, { encoding: "utf8" });
  assertScenarioSize(json);
  return parseScenario(json);
}
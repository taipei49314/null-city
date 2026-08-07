import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assertScenarioSize, parseScenario, type Scenario } from "@null-city/scenario-schema";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Loads a scenario by name from the shared scenarios/ directory.
 * Names are restricted to [a-z0-9-] so the loader can never escape the
 * scenarios folder.
 */
export function loadScenario(name: string): Scenario {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`invalid scenario name ${JSON.stringify(name)}; only [a-z0-9-] allowed`);
  }
  const json = readFileSync(join(REPO_ROOT, "scenarios", `${name}.json`), { encoding: "utf8" });
  assertScenarioSize(json);
  return parseScenario(json);
}

export type ScenarioLoader = (scenarioId: string) => Scenario;

export const defaultScenarioLoader: ScenarioLoader = loadScenario;

export function compileScenarioLoader(loader: ScenarioLoader): ScenarioLoader {
  const cache = new Map<string, Scenario>();
  return (scenarioId: string): Scenario => {
    const cached = cache.get(scenarioId);
    if (cached) {
      return cached;
    }
    const scenario = loader(scenarioId);
    cache.set(scenarioId, scenario);
    return scenario;
  };
}
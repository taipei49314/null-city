import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SCENARIO_IDS, goldenScriptFor, loadScenario, runScript, type SuiteScenarioId } from "@null-city/test-fixtures";

import { SimulationEngine } from "../index.js";
import { replayEventLog } from "../replay.js";

const SEED = 49314;
const RESUME_TICK = 200;

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function fail(name: string, detail: string): CheckResult {
  return { name, pass: false, detail };
}

function ok(name: string, detail: string): CheckResult {
  return { name, pass: true, detail };
}

function makeEngine(seed: number, scenarioId: SuiteScenarioId) {
  const scenario = loadScenario(scenarioId);
  const engine = new SimulationEngine({
    scenario,
    seed,
    sessionId: `verify-${scenarioId}-${seed}`,
  });
  runScript(engine, goldenScriptFor(scenarioId));
  engine.runToEnd();
  return engine;
}

function scanForbidden(packageRoot: string): string[] {
  const needleDot = `.`;
  const forbidden: Array<[string, string]> = [
    ["Math" + needleDot + "random", "Math" + needleDot + "random"],
    ["Date" + needleDot + "now", "Date" + needleDot + "now"],
    ["new" + " Date", "new" + " Date" + "()"],
  ];
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === "build" || entry === ".git") {
          continue;
        }
        walk(full);
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        const content = readFileSync(full, "utf8");
        for (const [needle, label] of forbidden) {
          if (content.includes(needle)) {
            hits.push(`${relative(process.cwd(), full)}: contains ${label}`);
          }
        }
      }
    }
  };
  walk(packageRoot);
  return hits;
}

function resultsEqual(a: ReturnType<SimulationEngine["result"]>, b: ReturnType<SimulationEngine["result"]>): boolean {
  return (
    a.eventLogHash === b.eventLogHash &&
    a.finalStateDigest === b.finalStateDigest &&
    a.score.total === b.score.total
  );
}

function main(): void {
  const checks: CheckResult[] = [];

  for (const scenarioId of SCENARIO_IDS) {
    const scenario = loadScenario(scenarioId);

    // Test A: identical inputs produce identical outputs
    {
      const engineA = makeEngine(SEED, scenarioId);
      const engineB = makeEngine(SEED, scenarioId);
      const rA = engineA.result();
      const rB = engineB.result();
      if (resultsEqual(rA, rB)) {
        checks.push(ok(`A.same-seed-determinism[${scenarioId}]`, `hash=${rA.eventLogHash.slice(0, 16)} score=${rA.score.total}`));
      } else {
        checks.push(fail(`A.same-seed-determinism[${scenarioId}]`, `hashA=${rA.eventLogHash} hashB=${rB.eventLogHash}`));
      }
    }

    // Test B: different seed diverges
    {
      const engineA = makeEngine(SEED, scenarioId);
      const engineB = makeEngine(SEED + 7, scenarioId);
      const rA = engineA.result();
      const rB = engineB.result();
      if (rA.eventLogHash !== rB.eventLogHash || rA.finalStateDigest !== rB.finalStateDigest) {
        checks.push(ok(`B.different-seed-divergence[${scenarioId}]`, `hashA=${rA.eventLogHash.slice(0, 16)} hashB=${rB.eventLogHash.slice(0, 16)}`));
      } else {
        checks.push(fail(`B.different-seed-divergence[${scenarioId}]`, "identical outputs for different seeds"));
      }
    }

    // Test C: replay from event log reproduces the original run
    {
      const original = makeEngine(SEED, scenarioId);
      const replayed = replayEventLog(original.eventLog, scenario, original.sessionId, SEED);
      if (replayed.eventLogHash === original.eventLogHash && replayed.finalStateDigest() === original.finalStateDigest()) {
        checks.push(
          ok(`C.replay-equivalence[${scenarioId}]`, `replayHash=${replayed.eventLogHash.slice(0, 16)} originalHash=${original.eventLogHash.slice(0, 16)}`),
        );
      } else {
        checks.push(
          fail(`C.replay-equivalence[${scenarioId}]`, `replay=${replayed.eventLogHash} original=${original.eventLogHash}`),
        );
      }
    }

    // Test D: snapshot resume at RESUME_TICK matches uninterrupted execution
    {
      const interrupted = new SimulationEngine({ scenario, seed: SEED, sessionId: "resume-test" });
      runScript(interrupted, goldenScriptFor(scenarioId));
      while (interrupted.currentTick < RESUME_TICK && interrupted.step()) {
        // advance to the resume point
      }
      if (interrupted.currentTick !== RESUME_TICK) {
        checks.push(fail(`D.snapshot-resume[${scenarioId}]`, `could not reach resume tick; stopped at ${interrupted.currentTick}`));
      } else {
        const snapshot = interrupted.snapshot();
        const resumed = new SimulationEngine({
          scenario,
          seed: SEED,
          sessionId: "resume-test",
          resume: snapshot,
        });
        const direct = new SimulationEngine({ scenario, seed: SEED, sessionId: "resume-test" });
        runScript(direct, goldenScriptFor(scenarioId));
        while (direct.currentTick < RESUME_TICK && direct.step()) {
          // advance directly to the same point
        }
        runScript(resumed, goldenScriptFor(scenarioId).filter((c) => c.atTick >= RESUME_TICK + 1));
        runScript(direct, goldenScriptFor(scenarioId).filter((c) => c.atTick >= RESUME_TICK + 1));

        const rResumed = resumed.result();
        const rDirect = direct.result();
        if (resultsEqual(rResumed, rDirect)) {
          checks.push(ok(`D.snapshot-resume[${scenarioId}]`, `resumeTick=${RESUME_TICK} hash=${rResumed.eventLogHash.slice(0, 16)}`));
        } else {
          checks.push(
            fail(`D.snapshot-resume[${scenarioId}]`, `resumed=${rResumed.eventLogHash} direct=${rDirect.eventLogHash}`),
          );
        }
      }
    }
  }

  // Test E: forbidden randomness in the simulation package
  {
    const packageRoot = join(process.cwd(), "packages", "simulation");
    const hits = scanForbidden(packageRoot);
    if (hits.length === 0) {
      checks.push(ok("E.forbidden-randomness", `no forbidden temporal calls in packages/simulation`));
    } else {
      checks.push(fail("E.forbidden-randomness", hits.join("; ")));
    }
  }

  process.stdout.write("=== determinism verification ===\n");
  let allPass = true;
  for (const check of checks) {
    process.stdout.write(`${check.pass ? "PASS" : "FAIL"}  ${check.name}  ${check.detail}\n`);
    if (!check.pass) {
      allPass = false;
    }
  }
  process.exitCode = allPass ? 0 : 1;
}

main();
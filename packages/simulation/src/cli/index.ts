import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { canonicalJson } from "@null-city/contracts";
import { goldenScriptFor, runScript, type SuiteScenarioId } from "@null-city/test-fixtures";
import {
  SimulationEngine,
  loadScenarioByName,
  loadSnapshotFromFile,
  saveSnapshotAtomically,
} from "../index.js";
import { buildRunReceipt, saveReceipt } from "../receipt.js";
import { toPlayerEventLog } from "../player-log.js";

interface CliOptions {
  scenario: string;
  seed: number;
  savePath: string | null;
  resumePath: string | null;
  receiptPath: string | null;
  snapshotAt: number | null;
  useGolden: boolean;
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string", default: "black-river" },
      seed: { type: "string", default: "49314" },
      save: { type: "string" },
      resume: { type: "string" },
      receipt: { type: "string" },
      "snapshot-at": { type: "string" },
      golden: { type: "boolean", default: true },
      "no-golden": { type: "boolean", default: false },
    },
  });
  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) {
    throw new Error(`--seed must be an integer, got ${JSON.stringify(values.seed)}`);
  }
  const snapshotAt =
    values["snapshot-at"] === undefined ? null : Number(values["snapshot-at"]);
  if (snapshotAt !== null && !Number.isInteger(snapshotAt)) {
    throw new Error(`--snapshot-at must be an integer`);
  }
  return {
    scenario: values.scenario as string,
    seed,
    savePath: values.save ?? null,
    resumePath: values.resume ?? null,
    receiptPath: values.receipt ?? null,
    snapshotAt,
    useGolden: values["no-golden"] === true ? false : values.golden !== false,
  };
}

function main(): void {
  const options = parseCliOptions();
  const scenariosDir = join(process.cwd(), "scenarios");
  const scenario = loadScenarioByName(options.scenario, scenariosDir);

  let engine: SimulationEngine;
  if (options.resumePath) {
    const snapshot = loadSnapshotFromFile(options.resumePath);
    engine = new SimulationEngine({
      scenario,
      seed: snapshot.seed,
      sessionId: snapshot.sessionId,
      resume: snapshot,
    });
    process.stdout.write(`resumed session ${engine.sessionId} at tick ${engine.currentTick}\n`);
  } else {
    engine = new SimulationEngine({
      scenario,
      seed: options.seed,
      sessionId: `cli-${options.scenario}-${options.seed}`,
    });
  }

  const golden = () => goldenScriptFor(options.scenario as SuiteScenarioId);

  if (!options.resumePath && options.snapshotAt !== null && options.savePath) {
    if (options.useGolden) {
      runScript(
        engine,
        golden().filter((command) => command.atTick <= options.snapshotAt!),
      );
    }
    while (engine.currentTick < options.snapshotAt && engine.step()) {
      // advance to snapshot tick
    }
    mkdirSync(dirname(options.savePath), { recursive: true });
    saveSnapshotAtomically(options.savePath, engine.snapshot());
    process.stdout.write(`mid-run snapshot saved to ${options.savePath} at tick ${engine.currentTick}\n`);
    const resumed = new SimulationEngine({
      scenario,
      seed: options.seed,
      sessionId: engine.sessionId,
      resume: loadSnapshotFromFile(options.savePath),
    });
    if (options.useGolden) {
      runScript(
        resumed,
        golden().filter((command) => command.atTick > options.snapshotAt!),
      );
    }
    engine = resumed;
  } else if (options.useGolden && !options.resumePath) {
    runScript(engine, golden());
  }

  const result = engine.runToEnd();
  const receipt = buildRunReceipt({
    result,
    events: engine.eventLog,
    playerEvents: toPlayerEventLog(engine.eventLog),
  });

  process.stdout.write("=== NULL CITY simulation result ===\n");
  process.stdout.write(`scenario      : ${scenario.id} (${scenario.name})\n`);
  process.stdout.write(`seed          : ${options.seed}\n`);
  process.stdout.write(`session       : ${engine.sessionId}\n`);
  process.stdout.write(`final tick    : ${result.finalTick}\n`);
  process.stdout.write(`event count   : ${result.eventCount}\n`);
  process.stdout.write(`event log hash: ${result.eventLogHash}\n`);
  process.stdout.write(`player log hash: ${receipt.playerLogHash}\n`);
  process.stdout.write(`final score   : ${result.score.total}\n`);
  process.stdout.write(`score breakdown:\n`);
  for (const item of result.score.breakdown) {
    process.stdout.write(`  ${item.id.padEnd(22)} ${item.delta.toString().padStart(8)}  ${item.reason}\n`);
  }
  process.stdout.write(`handled       : ${result.handledIncidents.join(",") || "(none)"}\n`);
  process.stdout.write(`still active  : ${result.activeIncidents.join(",") || "(none)"}\n`);
  process.stdout.write(`observations delivered: ${result.deliveredObservationCount}\n`);
  process.stdout.write(`final state digest:\n`);
  const digest = JSON.parse(result.finalStateDigest);
  process.stdout.write(`  ${canonicalJson(digest)}\n`);

  if (options.savePath && options.snapshotAt === null) {
    saveSnapshotAtomically(options.savePath, engine.snapshot());
    process.stdout.write(`snapshot saved to ${options.savePath}\n`);
  }

  const receiptPath = options.receiptPath ?? "data/last-run.receipt.json";
  if (receiptPath) {
    mkdirSync(dirname(receiptPath), { recursive: true });
    saveReceipt(receiptPath, receipt);
    process.stdout.write(`receipt saved to ${receiptPath}\n`);
    process.stdout.write(`receipt hash  : ${receipt.receiptHash}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

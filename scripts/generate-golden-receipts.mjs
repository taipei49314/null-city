import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Generates the committed, versioned golden-receipt fixtures under
 * `scenarios/golden-receipts/` — one per suite scenario, each produced by
 * running that scenario's own reference (golden) script at a fixed seed.
 * `scripts/verify-golden-receipts.mjs` re-derives the same run from source
 * and fails if it ever drifts from what is committed here.
 *
 * Re-run this script deliberately (never automatically) when a scenario or
 * engine change legitimately changes a golden run's outcome, and review the
 * diff of the regenerated file before committing it — that diff *is* the
 * changelog for "why did the reference receipt change".
 */

const root = process.cwd();
const SEED = 49314;
const GOLDEN_RECEIPT_FORMAT = "null-city-golden-receipt";
const GOLDEN_RECEIPT_VERSION = 1;

function fail(message) {
  process.stderr.write(`FAIL generate-golden-receipts: ${message}\n`);
  process.exit(1);
}

async function main() {
  for (const rel of ["packages/simulation/dist/index.js", "packages/test-fixtures/dist/index.js"]) {
    if (!existsSync(join(root, rel))) {
      fail(`missing built artifact ${rel}; run pnpm build first`);
    }
  }

  const simulation = await import(pathToFileURL(join(root, "packages/simulation/dist/index.js")).href);
  const fixtures = await import(pathToFileURL(join(root, "packages/test-fixtures/dist/index.js")).href);
  const { buildRunReceipt, toPlayerEventLog } = simulation;

  const outDir = join(root, "scenarios", "golden-receipts");
  mkdirSync(outDir, { recursive: true });

  for (const scenarioId of fixtures.SCENARIO_IDS) {
    const scenario = fixtures.loadScenario(scenarioId);
    const sessionId = `golden-receipt-${scenarioId}`;
    const engine = new simulation.SimulationEngine({ scenario, seed: SEED, sessionId });
    fixtures.runScript(engine, fixtures.goldenScriptFor(scenarioId));
    const result = engine.runToEnd();

    const receipt = buildRunReceipt({
      result,
      events: engine.eventLog,
      playerEvents: toPlayerEventLog(engine.eventLog),
    });

    const wrapped = {
      format: GOLDEN_RECEIPT_FORMAT,
      version: GOLDEN_RECEIPT_VERSION,
      scenarioId,
      scenarioDigest: scenario.digest,
      seed: SEED,
      referenceScript: `goldenScriptFor("${scenarioId}")`,
      receipt,
    };

    const outPath = join(outDir, `${scenarioId}.receipt.json`);
    writeFileSync(outPath, JSON.stringify(wrapped, null, 2), { encoding: "utf8" });
    process.stdout.write(
      `wrote ${outPath} (scenarioDigest=${scenario.digest.slice(0, 16)} receiptHash=${receipt.receiptHash.slice(0, 16)} score=${receipt.scoreTotal})\n`,
    );
  }

  process.stdout.write("PASS generate-golden-receipts\n");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

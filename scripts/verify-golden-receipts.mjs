import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Regenerates every scenario's golden run from source (scenario JSON +
 * engine + reference/golden script, fixed seed) and diffs it against the
 * committed fixture in `scenarios/golden-receipts/`. This is a regression
 * gate: any change to a scenario's JSON, the engine, or a golden script
 * that alters a scenario's reference outcome fails loudly here instead of
 * silently drifting. It also independently re-verifies each committed
 * receipt's own hash chain and terminal-event digest via `verifyReceipt`.
 */

const root = process.cwd();
const SEED = 49314;

function fail(message) {
  process.stderr.write(`FAIL verify-golden-receipts: ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  for (const rel of ["packages/simulation/dist/index.js", "packages/test-fixtures/dist/index.js"]) {
    if (!existsSync(join(root, rel))) {
      process.stderr.write(`FAIL verify-golden-receipts: missing built artifact ${rel}; run pnpm build first\n`);
      process.exitCode = 1;
      return;
    }
  }

  const simulation = await import(pathToFileURL(join(root, "packages/simulation/dist/index.js")).href);
  const fixtures = await import(pathToFileURL(join(root, "packages/test-fixtures/dist/index.js")).href);
  const { SimulationEngine, buildRunReceipt, toPlayerEventLog, verifyReceipt } = simulation;

  let allOk = true;

  for (const scenarioId of fixtures.SCENARIO_IDS) {
    const goldenPath = join(root, "scenarios", "golden-receipts", `${scenarioId}.receipt.json`);
    if (!existsSync(goldenPath)) {
      fail(`missing committed golden receipt ${goldenPath}; run \`node scripts/generate-golden-receipts.mjs\` once and commit it`);
      allOk = false;
      continue;
    }
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

    const structural = verifyReceipt(golden.receipt);
    if (!structural.ok) {
      fail(`${scenarioId}: committed golden receipt fails structural verification: ${structural.reasons.join("; ")}`);
      allOk = false;
      continue;
    }

    const scenario = fixtures.loadScenario(scenarioId);
    if (scenario.digest !== golden.scenarioDigest) {
      fail(
        `${scenarioId}: scenario digest changed since the golden receipt was recorded ` +
          `(committed=${golden.scenarioDigest.slice(0, 16)} current=${scenario.digest.slice(0, 16)}); ` +
          `regenerate with scripts/generate-golden-receipts.mjs if this is an intentional scenario change`,
      );
      allOk = false;
      continue;
    }

    const sessionId = `golden-receipt-${scenarioId}`;
    const engine = new SimulationEngine({ scenario, seed: golden.seed ?? SEED, sessionId });
    fixtures.runScript(engine, fixtures.goldenScriptFor(scenarioId));
    const result = engine.runToEnd();
    const fresh = buildRunReceipt({ result, events: engine.eventLog, playerEvents: toPlayerEventLog(engine.eventLog) });

    const mismatches = [];
    if (fresh.receiptHash !== golden.receipt.receiptHash) mismatches.push("receiptHash");
    if (fresh.eventLogHash !== golden.receipt.eventLogHash) mismatches.push("eventLogHash");
    if (fresh.scoreTotal !== golden.receipt.scoreTotal) mismatches.push("scoreTotal");
    if (fresh.finalTick !== golden.receipt.finalTick) mismatches.push("finalTick");
    if (JSON.stringify(fresh.handledIncidents) !== JSON.stringify(golden.receipt.handledIncidents)) mismatches.push("handledIncidents");
    if (JSON.stringify(fresh.activeIncidents) !== JSON.stringify(golden.receipt.activeIncidents)) mismatches.push("activeIncidents");

    if (mismatches.length > 0) {
      fail(`${scenarioId}: fresh run diverges from committed golden receipt on: ${mismatches.join(", ")}`);
      allOk = false;
      continue;
    }

    process.stdout.write(
      `PASS ${scenarioId} receiptHash=${fresh.receiptHash.slice(0, 16)} score=${fresh.scoreTotal} tick=${fresh.finalTick}\n`,
    );
  }

  if (allOk) {
    process.stdout.write("PASS verify-golden-receipts\n");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

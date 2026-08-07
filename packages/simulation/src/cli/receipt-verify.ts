import { parseArgs } from "node:util";
import { loadReceipt, verifyReceipt } from "../receipt.js";

/**
 * Legacy RunReceipt v1 integrity check (M10 P1-01).
 *
 * This command intentionally does NOT claim full verification: a receipt can
 * be resealed after rewriting identity metadata. Prefer `null-city-run verify`
 * against an artifact v2 with scenario replay.
 */
function main(): void {
  const { values } = parseArgs({
    options: {
      receipt: { type: "string" },
    },
  });
  if (!values.receipt) {
    throw new Error("--receipt <path> is required");
  }
  const receipt = loadReceipt(values.receipt);
  const result = verifyReceipt(receipt);
  if (!result.ok) {
    process.stderr.write(`FAIL legacy receipt integrity:\n`);
    for (const reason of result.reasons) {
      process.stderr.write(`  - ${reason}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `PARTIAL legacy-receipt-integrity ${receipt.sessionId} hash=${receipt.receiptHash.slice(0, 16)} ` +
      `events=${receipt.eventCount} (NOT full verification; use null-city-run artifact v2)\n`,
  );
  // Distinct from full PASS — receipts are integrity-only.
  process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

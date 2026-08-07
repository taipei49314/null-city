#!/usr/bin/env node
/**
 * Runs legacy receipt integrity check and accepts exit 0 (none) or 2 (PARTIAL).
 * Exit 1 remains a hard failure.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const receipt = process.argv[2];
if (!receipt) {
  process.stderr.write("usage: run-receipt-integrity.mjs <receipt-path>\n");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [join(process.cwd(), "packages/simulation/dist/cli/receipt-verify.js"), "--receipt", receipt],
  { encoding: "utf8", stdio: "inherit" },
);

const code = result.status ?? 1;
if (code === 0 || code === 2) {
  process.exit(0);
}
process.exit(code);

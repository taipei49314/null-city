import { mkdtempSync, rmSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();

function fail(message) {
  process.stderr.write(`FAIL package-smoke: ${message}\n`);
  process.exit(1);
}

async function main() {
  for (const rel of [
    "packages/contracts/dist/index.js",
    "packages/contracts/dist/truth-entry.js",
    "packages/simulation/dist/index.js",
    "packages/simulation/dist/cli/index.js",
    "packages/server/dist/index.js",
    "packages/server/dist/cli/start.js",
  ]) {
    if (!existsSync(join(root, rel))) {
      fail(`missing built artifact ${rel}`);
    }
  }

  // The public entry point is player-safe (audit P1-09); truth-side
  // verification lives behind the `/truth` subpath and must not leak into it.
  const contracts = await import(pathToFileURL(join(root, "packages/contracts/dist/index.js")).href);
  if (typeof contracts.sha256 !== "function" || typeof contracts.verifyPlayerEventStream !== "function") {
    fail("contracts dist public export missing sha256/verifyPlayerEventStream");
  }
  for (const truthOnly of ["verifyEventStream", "verifyEventChain", "eventHash"]) {
    if (truthOnly in contracts) {
      fail(`contracts dist public export leaks truth-only symbol ${truthOnly}`);
    }
  }

  const contractsTruth = await import(pathToFileURL(join(root, "packages/contracts/dist/truth-entry.js")).href);
  if (typeof contractsTruth.verifyEventStream !== "function" || typeof contractsTruth.eventHash !== "function") {
    fail("contracts dist truth export missing verifyEventStream/eventHash");
  }

  const simulation = await import(pathToFileURL(join(root, "packages/simulation/dist/index.js")).href);
  if (typeof simulation.SimulationEngine !== "function" || typeof simulation.buildRunReceipt !== "function") {
    fail("simulation dist missing SimulationEngine/buildRunReceipt");
  }

  const serverMod = await import(pathToFileURL(join(root, "packages/server/dist/index.js")).href);
  if (typeof serverMod.createServer !== "function") {
    fail("server dist missing createServer");
  }

  const app = serverMod.createServer();
  const port = await app.listen(0, "127.0.0.1");
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    if (!health.ok) {
      fail(`health check failed: ${health.status}`);
    }
  } finally {
    await app.close();
  }

  const dir = mkdtempSync(join(tmpdir(), "null-city-smoke-"));
  try {
    const packDir = join(dir, "pack");
    cpSync(join(root, "packages/simulation/dist"), join(packDir, "dist"), { recursive: true });
    writeFileSync(
      join(packDir, "package.json"),
      JSON.stringify({ name: "null-city-sim-smoke", type: "module" }, null, 2),
    );

    const cli = spawnSync(process.execPath, [join(root, "packages/simulation/dist/cli/index.js"), "--seed", "not-a-number"], {
      cwd: root,
      encoding: "utf8",
    });
    if (cli.status === 0) {
      fail("cli should reject non-integer seed");
    }

    process.stdout.write("PASS package-smoke: dist import + server listen/health + cli node path\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

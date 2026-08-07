#!/usr/bin/env node
/**
 * `pnpm demo` — one command to reach the browser Command Center.
 *
 * Builds whatever workspace packages are missing, starts the public
 * `@null-city/server` on http://127.0.0.1:8787, waits for /health, then
 * starts the command-center dev server and prints the browser URL. Both
 * child processes are killed on exit (Ctrl+C, error, or normal exit).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER_PORT = Number(process.env["PORT"] ?? "8787");
const SERVER_HOST = process.env["HOST"] ?? "127.0.0.1";
const APP_PORT = 5173;

const REQUIRED_DIST_FILES = [
  "packages/contracts/dist/index.js",
  "packages/epistemics/dist/index.js",
  "packages/scenario-schema/dist/index.js",
  "packages/simulation/dist/index.js",
  "packages/server/dist/cli/start.js",
];

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;

function log(message) {
  process.stdout.write(`[demo] ${message}\n`);
}

function killTree(child, signal) {
  if (child.killed || child.exitCode !== null || child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      // child.kill() alone leaves grandchildren (e.g. the actual vite dev
      // server spawned through `pnpm --filter ... dev`) running on Windows.
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill(signal ?? "SIGTERM");
    }
  } catch {
    // already gone
  }
}

function killAll(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    killTree(child, signal);
  }
}

process.on("SIGINT", () => {
  log("shutting down…");
  killAll("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll("SIGTERM");
  process.exit(0);
});
process.on("exit", () => killAll());

function ensureBuilt() {
  const missing = REQUIRED_DIST_FILES.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
  if (missing.length === 0) {
    return;
  }
  log(`building workspace packages (missing: ${missing.join(", ")})…`);
  const result = spawnSync("pnpm", ["-r", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error("workspace build failed");
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

async function startServer() {
  log(`starting @null-city/server on http://${SERVER_HOST}:${SERVER_PORT} …`);
  const child = spawn(process.execPath, [join(REPO_ROOT, "packages/server/dist/cli/start.js")], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT), HOST: SERVER_HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[demo] server exited unexpectedly with code ${code}\n`);
      killAll();
      process.exit(code ?? 1);
    }
  });

  await waitForHttp(`http://${SERVER_HOST}:${SERVER_PORT}/health`, 20000);
  log("server is healthy.");
  return child;
}

function startClient() {
  log("starting command-center dev server…");
  const appRoot = join(REPO_ROOT, "apps", "command-center");
  // Invoke vite's JS entry directly (no pnpm/shell passthrough) — pnpm's
  // `-- --host ...` arg forwarding does not reliably reach vite's own CLI,
  // and shell:true breaks on paths containing spaces.
  const viteEntry = join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteEntry, "dev", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"],
    {
      cwd: appRoot,
      env: { ...process.env, NULLCITY_SERVER_ORIGIN: `http://${SERVER_HOST}:${SERVER_PORT}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[client] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[client] ${chunk}`));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[demo] client exited unexpectedly with code ${code}\n`);
      killAll();
      process.exit(code ?? 1);
    }
  });
  return child;
}

async function main() {
  ensureBuilt();
  await startServer();
  startClient();
  await waitForHttp(`http://127.0.0.1:${APP_PORT}/`, 30000);

  const url = `http://127.0.0.1:${APP_PORT}/`;
  log("");
  log("========================================================");
  log(`  NULL CITY Command Center is ready:  ${url}`);
  log("  Press Ctrl+C to stop the server and dev client.");
  log("========================================================");
  log("");
}

main().catch((error) => {
  process.stderr.write(`[demo] error: ${error instanceof Error ? error.message : String(error)}\n`);
  killAll();
  process.exitCode = 1;
});

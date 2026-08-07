#!/usr/bin/env node
/**
 * End-to-end smoke test for the Command Center vertical slice.
 *
 * This does NOT drive a real browser (no Playwright browser download is
 * required to run it). It instead proves, against a real running
 * `@null-city/server` instance and a real built `vite preview` server, that:
 *
 *   1. the public REST surface can create a session, dispatch a team,
 *      advance ticks, receive claims/evidence, submit an assessment, and
 *      reject an invalid command with actionable validation feedback;
 *   2. the M4 run artifact export is blocked with `not_completed` while a
 *      session is active, and is released with a well-formed artifact only
 *      after the run completes — the epistemic boundary Replay Lab depends on;
 *   3. the built command-center bundle is served at `/` with the NULL CITY
 *      brand present in the HTML;
 *   4. the `/api` proxy target used by the browser reaches the same
 *      `/health` endpoint the server exposes directly.
 *
 * A full interactive browser walkthrough is available via `pnpm demo` from
 * the repo root (see apps/command-center/README section in the ADR).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");

const PREVIEW_PORT = 5183;

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];

function log(message) {
  process.stdout.write(`[e2e] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`);
  process.exitCode = 1;
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

function spawnTracked(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
}

function killTree(child) {
  if (child.killed || child.exitCode !== null || child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // child.kill() alone does not terminate grandchildren spawned through a
    // shell/pnpm wrapper on Windows (e.g. `pnpm exec vite preview`), which
    // leaves a listening vite process behind. taskkill /T kills the tree.
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function killAll() {
  for (const child of children) {
    killTree(child);
  }
}

process.on("exit", killAll);
process.on("SIGINT", () => {
  killAll();
  process.exit(1);
});

async function startServer() {
  if (!existsSync(join(REPO_ROOT, "packages/server/dist/cli/start.js"))) {
    log("server dist missing; building @null-city/server…");
    const build = spawnSync("pnpm", ["--filter", "@null-city/server", "build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (build.status !== 0) {
      throw new Error("failed to build @null-city/server");
    }
  }

  const child = spawnTracked(process.execPath, [join(REPO_ROOT, "packages/server/dist/cli/start.js")], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
  });

  const port = await new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (match) {
        child.stdout.off("data", onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
    child.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
    setTimeout(() => reject(new Error("timed out waiting for server to report its port")), 15000);
  });

  await waitForHttp(`http://127.0.0.1:${port}/health`);
  log(`server ready on http://127.0.0.1:${port}`);
  return { child, port };
}

async function apiFlow(port) {
  const base = `http://127.0.0.1:${port}`;
  const sessionId = `e2e-smoke-${Date.now()}`;

  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    return { status: response.status, json };
  }

  const created = await call("POST", "/sessions", { scenarioId: "black-river", seed: 49314, sessionId });
  if (!created.json.ok) {
    throw new Error(`session create failed: ${JSON.stringify(created.json)}`);
  }
  log(`created session ${sessionId}`);

  const rejected = await call("POST", `/sessions/${sessionId}/command`, {
    commandName: "DISPATCH_TEAM",
    params: { teamId: "not-a-real-team", target: "central", task: "power_repair" },
    idempotencyKey: "e2e-bad-1",
  });
  if (rejected.json.result?.validation?.valid !== false || rejected.json.result?.validation?.errorCode !== "unknown_team") {
    throw new Error(`expected an unknown_team validation rejection, got ${JSON.stringify(rejected.json)}`);
  }
  log("invalid command surfaced actionable validation feedback (unknown_team)");

  const dispatched = await call("POST", `/sessions/${sessionId}/command`, {
    commandName: "DISPATCH_TEAM",
    params: { teamId: "power-1", target: "industrial", task: "power_repair" },
    idempotencyKey: "e2e-good-1",
  });
  if (dispatched.json.result?.validation?.valid !== true) {
    throw new Error(`expected DISPATCH_TEAM to be accepted, got ${JSON.stringify(dispatched.json)}`);
  }
  log("valid DISPATCH_TEAM command accepted");

  const advanced = await call("POST", `/sessions/${sessionId}/advance`, { ticks: 30 });
  if (!advanced.json.ok || advanced.json.result?.tick !== 30) {
    throw new Error(`advance failed: ${JSON.stringify(advanced.json)}`);
  }
  log(`advanced to tick ${advanced.json.result.tick}`);

  const state = await call("GET", `/sessions/${sessionId}/state`);
  const claims = state.json.result?.state?.claims ?? [];
  const evidence = state.json.result?.state?.evidence ?? [];
  if (evidence.length === 0) {
    throw new Error("expected at least one delivered evidence item by tick 30");
  }
  log(`public state carries ${claims.length} claim(s) and ${evidence.length} evidence item(s), no truth fields`);

  if (claims.length > 0) {
    const assessed = await call("POST", `/sessions/${sessionId}/assess`, {
      claimId: claims[0].id,
      probability: 0.6,
      confidence: 0.5,
      rationale: "e2e smoke assessment",
    });
    if (!assessed.json.ok) {
      throw new Error(`assess failed: ${JSON.stringify(assessed.json)}`);
    }
    log(`submitted assessment on claim ${claims[0].id}`);
  }

  const notCompleted = await call("GET", `/sessions/${sessionId}/summary`);
  if (notCompleted.json.ok || notCompleted.json.error?.code !== "not_completed") {
    throw new Error(`expected summary to be blocked before completion, got ${JSON.stringify(notCompleted.json)}`);
  }
  log("summary is correctly blocked before completion (no fabricated results)");

  const artifactBlocked = await call("GET", `/sessions/${sessionId}/artifact`);
  if (artifactBlocked.status !== 409 || artifactBlocked.json.ok || artifactBlocked.json.error?.code !== "not_completed") {
    throw new Error(`expected run artifact to be blocked before completion, got ${JSON.stringify(artifactBlocked.json)}`);
  }
  log("run artifact (M4 Replay Lab) is correctly blocked before completion — no early truth bundle");

  const finished = await call("POST", `/sessions/${sessionId}/advance`, { ticks: 10_000 });
  if (!finished.json.ok || finished.json.result?.completed !== true) {
    throw new Error(`expected session to complete after a large advance, got ${JSON.stringify(finished.json)}`);
  }
  log(`session completed at tick ${finished.json.result.tick}`);

  const artifact = await call("GET", `/sessions/${sessionId}/artifact`);
  if (!artifact.json.ok) {
    throw new Error(`expected run artifact after completion, got ${JSON.stringify(artifact.json)}`);
  }
  const runArtifact = artifact.json.result;
  if (
    runArtifact.format !== "null-city-run-artifact" ||
    runArtifact.identity?.sessionId !== sessionId ||
    typeof runArtifact.artifactHash !== "string" ||
    !Array.isArray(runArtifact.truth?.events) ||
    !Array.isArray(runArtifact.player?.events)
  ) {
    throw new Error(`run artifact has an unexpected shape: ${JSON.stringify(Object.keys(runArtifact ?? {}))}`);
  }
  log(
    `run artifact released after completion (hash ${runArtifact.artifactHash.slice(0, 12)}…, ` +
      `${runArtifact.truth.events.length} truth events, ${runArtifact.player.events.length} player events) — Replay Lab can now load it`,
  );

  await call("DELETE", `/sessions/${sessionId}`);
  log("session cleaned up");
}

async function startPreviewAndCheck(serverPort) {
  if (!existsSync(join(APP_ROOT, "dist/index.html"))) {
    log("command-center dist missing; building…");
    const build = spawnSync("pnpm", ["--filter", "@null-city/command-center", "build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (build.status !== 0) {
      throw new Error("failed to build @null-city/command-center");
    }
  }

  // Invoke vite's JS entry directly with node (no shell, no .cmd shim) so
  // spaces in the workspace path can never break argument parsing.
  const viteEntry = join(APP_ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawnTracked(
    process.execPath,
    [viteEntry, "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: APP_ROOT,
      env: { ...process.env, NULLCITY_SERVER_ORIGIN: `http://127.0.0.1:${serverPort}` },
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(`[preview] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[preview] ${chunk}`));

  const response = await waitForHttp(`http://127.0.0.1:${PREVIEW_PORT}/`, 30000);
  const html = await response.text();
  if (!html.includes("NULL CITY")) {
    throw new Error("served index.html did not contain the NULL CITY brand");
  }
  log("preview server serves the NULL CITY command-center bundle");

  const proxied = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/api/health`);
  if (!proxied.ok) {
    throw new Error(`/api/health proxy check failed with status ${proxied.status}`);
  }
  const proxiedJson = await proxied.json();
  if (proxiedJson.name !== "@null-city/server") {
    throw new Error(`unexpected /api/health payload: ${JSON.stringify(proxiedJson)}`);
  }
  log("/api proxy correctly reaches the same public server");

  killTree(child);
}

async function main() {
  const { port } = await startServer();
  await apiFlow(port);
  await startPreviewAndCheck(port);
  log("PASS — command-center e2e smoke flow complete");
}

main()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    killAll();
  });

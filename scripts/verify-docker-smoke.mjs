#!/usr/bin/env node
/**
 * `pnpm verify:docker` — Docker smoke test for the packaged demo image.
 *
 * NOT part of `pnpm verify` and NOT run automatically by any local
 * developer workflow: Docker Desktop/daemon is not guaranteed to be running
 * on a contributor's machine, and `pnpm verify` must stay green without it
 * (see docs/architecture.md's packaging section). This script is meant to
 * be invoked explicitly, and is wired as its own required CI job
 * (`.github/workflows/ci.yml`, job `docker-smoke`) where a Docker daemon is
 * always available.
 *
 * It builds the image from the repo `Dockerfile`, starts the two
 * `docker-compose.yml` services (`server`, `command-center`), waits for the
 * server's `/health` endpoint, drives one real scenario session through the
 * containerized server's public REST surface, checks the containerized
 * command-center bundle is served, and tears the stack down — win or lose.
 */
import { spawnSync } from "node:child_process";

function log(message) {
  process.stdout.write(`[docker-smoke] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`FAIL docker-smoke: ${message}\n`);
  process.exitCode = 1;
}

function run(args, opts = {}) {
  return spawnSync("docker", args, { stdio: "inherit", ...opts });
}

async function waitForHttp(url, timeoutMs) {
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

async function main() {
  const version = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (version.status !== 0) {
    fail("no reachable Docker daemon (Docker Desktop/engine must be running). This gate is CI-only/optional locally.");
    return;
  }

  log("building image via docker compose…");
  const build = run(["compose", "build"]);
  if (build.status !== 0) {
    fail("docker compose build failed");
    return;
  }

  log("starting stack (server + command-center)…");
  const up = run(["compose", "up", "-d"]);
  if (up.status !== 0) {
    fail("docker compose up failed");
    return;
  }

  try {
    await waitForHttp("http://127.0.0.1:8787/health", 60000);
    log("server /health is up");

    const sessionId = `docker-smoke-${Date.now()}`;
    const created = await fetch("http://127.0.0.1:8787/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "black-river", seed: 49314, sessionId }),
    });
    const createdJson = await created.json();
    if (!createdJson.ok) {
      throw new Error(`session create failed: ${JSON.stringify(createdJson)}`);
    }
    log(`created session ${sessionId} inside the container`);

    const state = await fetch(`http://127.0.0.1:8787/sessions/${sessionId}/state`);
    const stateJson = await state.json();
    if (!stateJson.ok || typeof stateJson.result?.state?.tick !== "number") {
      throw new Error(`unexpected state response: ${JSON.stringify(stateJson)}`);
    }
    log(`session state readable at tick ${stateJson.result.state.tick}`);

    const centerResponse = await waitForHttp("http://127.0.0.1:4173/", 60000);
    const html = await centerResponse.text();
    if (!html.includes("NULL CITY")) {
      throw new Error("command-center container did not serve the NULL CITY bundle");
    }
    log("command-center container serves the built bundle");

    log("PASS docker-smoke");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    log("tearing down stack…");
    run(["compose", "down", "-v"]);
  }
}

main();

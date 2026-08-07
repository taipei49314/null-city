import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type NullCityServer } from "@null-city/server";

import { createPlayerSession } from "../src/session.js";
import { NetworkError } from "../src/errors.js";

const SEED = 49314;

describe("retries never duplicate a command", () => {
  let app: NullCityServer;
  let baseUrl: string;

  beforeEach(async () => {
    app = createServer();
    const port = await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("retries a transiently-failing submitCommand and reports exactly one acceptance", async () => {
    let commandAttempts = 0;
    const flakyFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/command") && commandAttempts === 0) {
        commandAttempts += 1;
        throw new Error("simulated transient network failure");
      }
      if (url.endsWith("/command")) {
        commandAttempts += 1;
      }
      return fetch(input, init);
    };

    const session = await createPlayerSession({
      baseUrl,
      scenarioId: "black-river",
      seed: SEED,
      fetchImpl: flakyFetch,
      retryBaseDelayMs: 5,
    });

    const outcome = await session.submitCommand({
      commandName: "DISPATCH_TEAM",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
      idempotencyKey: "retry-key-1",
    });

    expect(outcome.state).toBe("accepted");
    expect(outcome.deduplicated).toBe(false);
    expect(commandAttempts).toBe(2); // one failed attempt, one that reached the server

    const events = await session.getEvents(0);
    const accepted = events.filter((e) => e.kind === "CommandResult" && (e.payload as { state: string }).state === "accepted");
    expect(accepted).toHaveLength(1);
  });

  it("re-submitting the same idempotencyKey after success is reported as deduplicated, not re-executed", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    const first = await session.submitCommand({
      commandName: "DISPATCH_TEAM",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
      idempotencyKey: "manual-retry-key",
    });
    expect(first.state).toBe("accepted");
    expect(first.deduplicated).toBe(false);

    const second = await session.submitCommand({
      commandName: "DISPATCH_TEAM",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
      idempotencyKey: "manual-retry-key",
    });
    expect(second.deduplicated).toBe(true);

    const events = await session.getEvents(0);
    const accepted = events.filter((e) => e.kind === "CommandResult" && (e.payload as { state: string }).state === "accepted");
    expect(accepted).toHaveLength(1);
  });

  it("exhausts retries and surfaces a NetworkError when the server never responds", async () => {
    const alwaysFailFetch: typeof fetch = async () => {
      throw new Error("connection refused");
    };
    const session = await createPlayerSession({
      baseUrl,
      scenarioId: "black-river",
      seed: SEED,
    });
    // Swap in a failing fetch only for the read after session creation succeeded normally.
    const brokenSession = await createPlayerSession({
      baseUrl: "http://127.0.0.1:1", // nothing listens here
      scenarioId: "black-river",
      seed: SEED,
      fetchImpl: alwaysFailFetch,
      maxRetries: 1,
      retryBaseDelayMs: 5,
    }).catch((error) => error as Error);
    expect(brokenSession).toBeInstanceOf(NetworkError);
    await session.close();
  });

  it("never auto-retries advance(), since a lost response would double-advance the clock", async () => {
    let advanceAttempts = 0;
    const flakyFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/advance")) {
        advanceAttempts += 1;
        if (advanceAttempts === 1) {
          throw new Error("simulated transient network failure");
        }
      }
      return fetch(input, init);
    };
    const session = await createPlayerSession({
      baseUrl,
      scenarioId: "black-river",
      seed: SEED,
      fetchImpl: flakyFetch,
      retryBaseDelayMs: 5,
    });
    await expect(session.advance(5)).rejects.toBeInstanceOf(NetworkError);
    expect(advanceAttempts).toBe(1);
  });
});

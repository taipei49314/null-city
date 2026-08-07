import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

/**
 * M8 regressions for the REST transport boundary.
 *
 * Each test corresponds to a defect the adversarial suite found and would fail
 * against the inherited behaviour:
 *   - request bodies could redirect an operation onto a different session;
 *   - a malformed percent-encoded session id produced a 500;
 *   - a rejected scenario name produced `internal_error`;
 *   - an oversized body left the keep-alive connection desynchronised.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

async function call(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed };
}

describe("the URL, not the body, selects the session", () => {
  it("ignores a body sessionId on advance", async () => {
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-scope-victim" });
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-scope-attacker" });
    await call("/sessions/m8-scope-victim/advance", "POST", { ticks: 30 });

    const victimBefore = (await call("/sessions/m8-scope-victim/state")).body.result.tick;

    const crossed = await call("/sessions/m8-scope-attacker/advance", "POST", {
      sessionId: "m8-scope-victim",
      ticks: 60,
    });

    expect(crossed.body.result.sessionId).toBe("m8-scope-attacker");
    const victimAfter = (await call("/sessions/m8-scope-victim/state")).body.result.tick;
    expect(victimAfter).toBe(victimBefore);
  });

  it("ignores a body sessionId on command", async () => {
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-cmd-victim" });
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-cmd-attacker" });
    const victimBefore = (await call("/sessions/m8-cmd-victim/state")).body.result.playerLogHash;

    const crossed = await call("/sessions/m8-cmd-attacker/command", "POST", {
      sessionId: "m8-cmd-victim",
      commandName: "DISPATCH_TEAM",
      idempotencyKey: "m8-cross",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
    });

    expect(crossed.body.result.sessionId).toBe("m8-cmd-attacker");
    const victimAfter = (await call("/sessions/m8-cmd-victim/state")).body.result.playerLogHash;
    expect(victimAfter).toBe(victimBefore);
  });

  it("ignores a body sessionId on assess", async () => {
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-assess-victim" });
    const response = await call("/sessions/m8-assess-victim/assess", "POST", {
      sessionId: "m8-does-not-exist",
      claimId: "claim-x",
      probability: 0.5,
      confidence: 0.5,
    });
    // The addressed session exists, so this must fail on the unknown claim,
    // never with not_found for the body's session id.
    expect(response.body.error.code).toBe("invalid_params");
  });
});

describe("request validation returns classified errors", () => {
  it("rejects a malformed percent-encoded session id with 400", async () => {
    const response = await call("/sessions/%ZZ/state");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_params");
  });

  it("rejects an out-of-directory scenario name as invalid_params", async () => {
    const response = await call("/sessions", "POST", { scenarioId: "../../etc/passwd", seed: 1 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_params");
  });

  it("rejects an unknown scenario as invalid_params", async () => {
    const response = await call("/sessions", "POST", { scenarioId: "no-such-scenario", seed: 1 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_params");
  });
});

describe("oversized bodies", () => {
  it("returns 413 and leaves the connection usable", async () => {
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId: "m8-oversize" });

    const oversized = await call(
      "/sessions/m8-oversize/advance",
      "POST",
      JSON.stringify({ ticks: 1, filler: "A".repeat(2 * 1024 * 1024) }),
    );
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("payload_too_large");

    // The inherited behaviour abandoned the request stream mid-read, leaving a
    // desynchronised socket that reset a later request reusing it.
    for (let i = 0; i < 12; i += 1) {
      const follow = await call("/sessions/m8-oversize/advance", "POST", { ticks: 1 });
      expect(follow.status).toBe(200);
    }
  });
});

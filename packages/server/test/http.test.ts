import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";
import { SimulationEngine } from "@null-city/simulation";

import { driveScriptOverRest } from "../src/transport.js";
import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

async function expectError(path: string, method = "GET", body?: unknown, expectedStatus?: number): Promise<number> {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(expectedStatus === undefined ? true : response.status === expectedStatus).toBe(true);
  return response.status;
}

describe("REST surface", () => {
  it("serves a health check", async () => {
    const response = await fetch(`${ctx.baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("creates, lists, commands, advances a session and forbids raw snapshots", async () => {
    const created = await ctx.api.createSession({
      scenarioId: "black-river",
      seed: 49314,
      sessionId: "http-e2e-1",
    });
    expect(created["sessionId"]).toBe("http-e2e-1");

    const list = await ctx.api.list();
    expect(list["sessions"]).toContain("http-e2e-1");

    const command = await ctx.api.command(
      "http-e2e-1",
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "industrial", task: "power_repair" },
      "http-cmd-1",
    );
    expect(command["state"]).toBe("accepted");
    expect(Array.isArray(command["events"])).toBe(true);

    const advance = await ctx.api.advance("http-e2e-1", 6);
    expect(advance["tick"]).toBe(6);

    const events = await ctx.api.events("http-e2e-1", 0);
    expect(Array.isArray(events["events"])).toBe(true);
    expect(events["next"]).toBeGreaterThan(0);

    const snapshotStatus = await expectError("/sessions/http-e2e-1/snapshot", "GET", undefined, 403);
    expect(snapshotStatus).toBe(403);
  });

  it("reports conflict on a duplicate session id", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 1, sessionId: "rest-dup" });
    const status = await expectError("/sessions", "POST", { scenarioId: "black-river", seed: 1, sessionId: "rest-dup" }, 409);
    expect(status).toBe(409);
  });

  it("returns 404 for a missing session", async () => {
    const status = await expectError("/sessions/ghost/state", "GET", undefined, 404);
    expect(status).toBe(404);
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const response = await fetch(`${ctx.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    const status = await expectError("/nope", "GET", undefined, 404);
    expect(status).toBe(404);
  });

  it("deletes a session and then reports it missing", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 3, sessionId: "rest-del" });
    const removed = await ctx.api.del("rest-del");
    expect(removed["deleted"]).toBe(true);
    const status = await expectError("/sessions/rest-del/state", "GET", undefined, 404);
    expect(status).toBe(404);
  });

  it("drives a golden play over REST to the same score/tick with a public claim model", async () => {
    const sessionId = "rest-golden";
    const reference = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId });
    runScript(reference, goldenScript());
    reference.runToEnd();

    await ctx.api.createSession({ scenarioId: "black-river", seed: 49314, sessionId });
    await driveScriptOverRest(ctx.api, sessionId, goldenScript());
    await ctx.api.advance(sessionId, 540);

    const finalState = await ctx.api.state(sessionId);
    expect(finalState["score"]).toBe(reference.result().score.total);
    expect(finalState["tick"]).toBe(540);
    expect(typeof finalState["playerLogHash"]).toBe("string");
    expect((finalState["state"] as { claims: unknown[] }).claims.length).toBeGreaterThan(0);
  });
});
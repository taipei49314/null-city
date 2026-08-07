import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createServer, type NullCityServer } from "../src/index.js";

/**
 * M10 P0-01: claim-targeted REQUEST_VERIFICATION must resolve claims.
 */

interface Harness {
  app: NullCityServer;
  baseUrl: string;
}

async function call(
  baseUrl: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

describe("M10 P0-01 claim verification", () => {
  let ctx: Harness;

  beforeAll(async () => {
    const app = createServer();
    const port = await app.listen(0, "127.0.0.1");
    ctx = { app, baseUrl: `http://127.0.0.1:${port}` };
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("rejects district-only REQUEST_VERIFICATION on the public surface", async () => {
    const sessionId = "m10-verify-target-rejected";
    await call(ctx.baseUrl, "/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(ctx.baseUrl, `/sessions/${sessionId}/advance`, "POST", { ticks: 60 });
    const rejected = await call(ctx.baseUrl, `/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "m10-target-only",
      params: { teamId: "verify-1", target: "industrial" },
    });
    expect(rejected.body.error?.code).toBe("invalid_params");
    expect(String(rejected.body.error?.message ?? "")).toMatch(/claimId|must not include target/i);
  });

  it("rejects competing claimId+target on the public surface", async () => {
    const sessionId = "m10-verify-competing";
    await call(ctx.baseUrl, "/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(ctx.baseUrl, `/sessions/${sessionId}/advance`, "POST", { ticks: 60 });
    const state = await call(ctx.baseUrl, `/sessions/${sessionId}/state`);
    const claim = (state.body.result.state.claims ?? []).find((c: any) => c.districtId);
    expect(claim).toBeDefined();
    const rejected = await call(ctx.baseUrl, `/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "m10-competing",
      params: { teamId: "verify-1", claimId: claim.id, target: claim.districtId },
    });
    expect(rejected.body.error?.code).toBe("invalid_params");
    expect(String(rejected.body.error?.message ?? "")).toMatch(/must not include target/i);
  });

  it("emits VerificationResolved and resolves the intended claim", async () => {
    const sessionId = "m10-verify-resolved";
    await call(ctx.baseUrl, "/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(ctx.baseUrl, `/sessions/${sessionId}/advance`, "POST", { ticks: 80 });

    const state = await call(ctx.baseUrl, `/sessions/${sessionId}/state`);
    const claim = (state.body.result.state.claims ?? []).find((c: any) => c.districtId);
    const team = (state.body.result.state.teams ?? []).find((t: any) => t.type === "verification" && t.status === "idle");
    expect(claim).toBeDefined();
    expect(team).toBeDefined();

    const accepted = await call(ctx.baseUrl, `/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "m10-verify-1",
      params: { teamId: team.teamId, claimId: claim.id },
    });
    expect(accepted.body.result?.state).toBe("accepted");

    for (let i = 0; i < 200; i += 1) {
      await call(ctx.baseUrl, `/sessions/${sessionId}/advance`, "POST", { ticks: 5 });
      const events = await call(ctx.baseUrl, `/sessions/${sessionId}/events?since=0`);
      const list = events.body.result?.events ?? [];
      const resolved = list.find(
        (e: any) => e.kind === "VerificationResolved" && e.payload?.claimId === claim.id,
      );
      if (resolved) {
        expect(["verified", "refuted", "inconclusive"]).toContain(resolved.payload.outcome);
        const after = await call(ctx.baseUrl, `/sessions/${sessionId}/state`);
        const updated = (after.body.result.state.claims ?? []).find((c: any) => c.id === claim.id);
        if (resolved.payload.outcome === "verified" || resolved.payload.outcome === "refuted") {
          expect(updated?.status).toBe(resolved.payload.outcome);
        }
        return;
      }
      if (list.some((e: any) => e.kind === "RunCompleted")) {
        break;
      }
    }
    throw new Error("expected VerificationResolved before run end");
  });

  it("mechanically forbids restoring district-target params in verification-first source", () => {
    const source = readFileSync(
      join(process.cwd(), "..", "..", "packages/benchmark/src/policies/verificationFirst.ts"),
      "utf8",
    );
    expect(source).toMatch(/commandName:\s*"REQUEST_VERIFICATION"/);
    expect(source).toMatch(/claimId:\s*claim\.id/);
    expect(source).not.toMatch(
      /commandName:\s*"REQUEST_VERIFICATION"[\s\S]{0,120}target:\s*claim\.districtId/,
    );
  });
});

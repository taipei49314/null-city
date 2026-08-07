import WebSocket from "ws";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationEngine } from "@null-city/simulation";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";

import { handleAdminRpc, handleRpc, type RpcResult } from "../src/rpc.js";
import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

/**
 * Regressions for external audit findings P0-01 (untrusted snapshot resume),
 * P1-07 (verification targeting before acceptance) and P1-08 (advance under-
 * reports the tick delta).
 *
 * Every test here fails against the inherited behaviour: public `resume` was
 * accepted and adopted wholesale, `pendingClaimVerify` was written before the
 * engine saw the command, and `advance` counted loop iterations.
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
    body: body === undefined ? undefined : JSON.stringify(body),
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

function rpcFailure(result: RpcResult): { code: string; message: string } {
  if (result.ok) {
    throw new Error(`expected an RPC failure, got ${JSON.stringify(result.result)}`);
  }
  return result.error;
}

function rpcSuccess(result: RpcResult): unknown {
  if (!result.ok) {
    throw new Error(`expected an RPC success, got ${JSON.stringify(result.error)}`);
  }
  return result.result;
}

/** A genuine snapshot taken mid-run — the strongest input a forger could start from. */
function honestSnapshot(sessionId: string) {
  const engine = new SimulationEngine({ scenario: blackRiver(), seed: 49314, sessionId });
  runScript(engine, goldenScript());
  while (engine.currentTick < 120 && engine.step()) {
    // advance to a mid-run snapshot point
  }
  return structuredClone(engine.snapshot());
}

describe("P0-01: snapshot resume is not a public operation", () => {
  it("rejects a resume on public POST /sessions even when the snapshot is genuine", async () => {
    const snapshot = honestSnapshot("authority-honest");
    const response = await call("/sessions", "POST", {
      scenarioId: "black-river",
      seed: 49314,
      sessionId: "authority-honest",
      resume: snapshot,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body?.error?.code).toBe("forbidden");
    expect(String(response.body?.error?.message)).toMatch(/admin\.resume/);
  });

  it("rejects a forged snapshot whose hashes were recomputed to be self-consistent", async () => {
    const snapshot: any = honestSnapshot("authority-forged");
    // The forger owns the whole value: rewrite the world, then let the engine's
    // own validator find nothing wrong with it.
    for (const district of Object.values<any>(snapshot.world.districts)) {
      district.populationRisk = 0;
      district.hazardLevel = 0;
      district.power = 100;
    }
    snapshot.world.score.total = 999999;

    const response = await call("/sessions", "POST", {
      scenarioId: "black-river",
      seed: 49314,
      sessionId: "authority-forged",
      resume: snapshot,
    });
    expect(response.body?.error?.code).toBe("forbidden");

    const listed = await call("/sessions");
    expect(listed.body?.result?.sessions ?? []).not.toContain("authority-forged");
  });

  it("rejects resume on the default (public) handleRpc surface", () => {
    const snapshot = honestSnapshot("authority-default-surface");
    const result = handleRpc(ctx.app.hub, {
      op: "session.create",
      params: { scenarioId: "black-river", seed: 49314, sessionId: "authority-default-surface", resume: snapshot },
    });
    expect(rpcFailure(result).code).toBe("forbidden");
  });

  it("rejects admin.resume over the public surface", () => {
    const snapshot = honestSnapshot("authority-admin-op-public");
    const result = handleRpc(ctx.app.hub, {
      op: "admin.resume",
      params: { scenarioId: "black-river", seed: 49314, sessionId: "authority-admin-op-public", snapshot },
    });
    expect(rpcFailure(result).code).toBe("forbidden");
  });

  it("rejects admin.resume over the player websocket", async () => {
    const created = await call("/sessions", "POST", {
      scenarioId: "black-river",
      seed: 49314,
      sessionId: "authority-ws",
    });
    expect(created.status).toBe(200);

    const socket = new WebSocket(`ws://127.0.0.1:${new URL(ctx.baseUrl).port}/ws/authority-ws`);
    const messages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on("error", reject);
      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            type: "rpc",
            op: "admin.resume",
            requestId: "1",
            params: { scenarioId: "black-river", seed: 49314, snapshot: {} },
          }),
        );
      });
      socket.on("message", (data) => {
        const parsed = JSON.parse(String(data));
        messages.push(parsed);
        if (parsed.type === "rpc-result") {
          resolve();
        }
      });
      setTimeout(() => reject(new Error("timed out waiting for rpc-result")), 5000);
    });
    socket.close();

    const reply = messages.find((m) => m.type === "rpc-result");
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe("forbidden");
  });

  it("still allows a trusted in-process admin resume", () => {
    const sessionId = "authority-admin-ok";
    const snapshot = honestSnapshot(sessionId);
    const result = handleAdminRpc(ctx.app.hub, {
      op: "admin.resume",
      params: { scenarioId: "black-river", seed: 49314, sessionId, snapshot },
    });
    expect((rpcSuccess(result) as { tick: number }).tick).toBe(snapshot.tick);
  });

  it("admin resume still validates the snapshot's own binding and chain", () => {
    const snapshot: any = honestSnapshot("authority-admin-broken");
    snapshot.events[3].payload = { tampered: true };
    const result = handleAdminRpc(ctx.app.hub, {
      op: "admin.resume",
      params: { scenarioId: "black-river", seed: 49314, sessionId: "authority-admin-broken", snapshot },
    });
    expect(rpcFailure(result).message).toMatch(/snapshot event stream invalid/);
  });
});

describe("P1-01: admin resume rebuilds the player view from truth (documented limitation)", () => {
  it("restores truth-derived player state but not player-originated history", async () => {
    // See docs/decisions/2026-08-07-authority-and-replay-semantics.md §4.
    // This pins the honest limitation so it cannot drift into an unstated one.
    const sessionId = "authority-resume-history";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(`/sessions/${sessionId}/advance`, "POST", { ticks: 60 });

    const before = await call(`/sessions/${sessionId}/state`);
    const claim = (before.body.result.state.claims ?? []).find((c: any) => c.districtId);
    expect(claim).toBeDefined();
    await call(`/sessions/${sessionId}/assess`, "POST", {
      claimId: claim.id,
      probability: 0.8,
      confidence: 0.6,
      rationale: "pre-snapshot assessment",
    });

    const record = ctx.app.hub.get(sessionId)!;
    const snapshot = structuredClone(record.engine.snapshot());
    const beforeState = await call(`/sessions/${sessionId}/state`);
    const beforeAssessments = beforeState.body.result.state.assessments ?? [];
    expect(beforeAssessments.length).toBeGreaterThan(0);

    ctx.app.hub.delete(sessionId);
    const resumed = handleAdminRpc(ctx.app.hub, {
      op: "admin.resume",
      params: { scenarioId: "black-river", seed: 49314, sessionId, snapshot },
    });
    expect(rpcSuccess(resumed)).toBeTruthy();

    const after = await call(`/sessions/${sessionId}/state`);
    // Truth-derived view survives: same tick, same claim set.
    expect(after.body.result.tick).toBe(beforeState.body.result.tick);
    expect((after.body.result.state.claims ?? []).map((c: any) => c.id)).toEqual(
      (beforeState.body.result.state.claims ?? []).map((c: any) => c.id),
    );
    // Player-originated history does not: assessments are gone and the player
    // log is a freshly derived stream with a different terminal hash.
    expect(after.body.result.state.assessments ?? []).toEqual([]);
    expect(after.body.result.playerLogHash).not.toBe(beforeState.body.result.playerLogHash);
    expect(ctx.app.hub.get(sessionId)!.pendingClaimVerify.size).toBe(0);
  });
});

describe("P1-08: advance reports the ticks it actually executed", () => {
  it("reports the full delta when the request runs a scenario to completion", async () => {
    const sessionId = "authority-advance";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    const totalTicks = blackRiver().totalTicks;

    const response = await call(`/sessions/${sessionId}/advance`, "POST", { ticks: totalTicks });
    expect(response.status).toBe(200);
    const result = response.body.result;
    expect(result.tick).toBe(totalTicks);
    // The inherited implementation counted loop iterations and reported
    // totalTicks - 1 here, because the terminal step returns false.
    expect(result.advanced).toBe(totalTicks);
    expect(result.completed).toBe(true);
  });

  it("reports zero once the run is already complete", async () => {
    const sessionId = "authority-advance-done";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    const totalTicks = blackRiver().totalTicks;
    await call(`/sessions/${sessionId}/advance`, "POST", { ticks: totalTicks });

    const again = await call(`/sessions/${sessionId}/advance`, "POST", { ticks: 10 });
    expect(again.body.result.advanced).toBe(0);
    expect(again.body.result.tick).toBe(totalTicks);
  });

  it("reports a partial delta for a bounded advance", async () => {
    const sessionId = "authority-advance-partial";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    const response = await call(`/sessions/${sessionId}/advance`, "POST", { ticks: 30 });
    expect(response.body.result.advanced).toBe(30);
    expect(response.body.result.tick).toBe(30);
  });
});

describe("P1-07: verification targeting follows command acceptance", () => {
  it("does not bind a claim when the verification command is rejected", async () => {
    const sessionId = "authority-verify-rejected";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(`/sessions/${sessionId}/advance`, "POST", { ticks: 60 });

    const state = await call(`/sessions/${sessionId}/state`);
    const claims = state.body.result.state.claims ?? [];
    const claim = claims.find((c: any) => c.districtId);
    expect(claim, "expected at least one district-bound claim after 60 ticks").toBeDefined();

    const record = ctx.app.hub.get(sessionId)!;
    expect(record.pendingClaimVerify.size).toBe(0);

    // A non-existent team makes the engine reject the command outright.
    const rejected = await call(`/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "authority-verify-rejected-1",
      params: { teamId: "no-such-team", claimId: claim.id },
    });
    expect(rejected.body.result?.state ?? rejected.body.error?.code).not.toBe("accepted");
    // The inherited code wrote the binding before submitting, so this map was
    // left holding a target that later resolved off unrelated work.
    expect(record.pendingClaimVerify.size).toBe(0);
  });

  it("binds a claim to the accepted order and clears it when a later request is rejected", async () => {
    const sessionId = "authority-verify-accepted";
    await call("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
    await call(`/sessions/${sessionId}/advance`, "POST", { ticks: 60 });

    const state = await call(`/sessions/${sessionId}/state`);
    const claim = (state.body.result.state.claims ?? []).find((c: any) => c.districtId);
    expect(claim).toBeDefined();
    // Only a verification team can be given the `verify` task.
    const team = state.body.result.state.teams.find((t: any) => t.type === "verification");
    expect(team, "black-river must have a verification team").toBeDefined();
    const teamId = team.teamId;

    const accepted = await call(`/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "authority-verify-accepted-1",
      params: { teamId, claimId: claim.id },
    });
    expect(accepted.body.result?.state).toBe("accepted");

    const record = ctx.app.hub.get(sessionId)!;
    const pending = record.pendingClaimVerify.get(teamId);
    expect(pending?.claimId).toBe(claim.id);
    // The binding names the order it belongs to, so unrelated work by the same
    // team can never resolve it.
    expect(typeof pending?.orderId).toBe("string");
    expect(pending!.orderId.length).toBeGreaterThan(0);
    expect(pending?.commandId).toBe(accepted.body.result.commandId);

    const rejectedFollowUp = await call(`/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "authority-verify-accepted-2",
      params: { teamId, claimId: "claim-that-does-not-exist" },
    });
    expect(rejectedFollowUp.body.error?.code).toBe("invalid_params");
    // An unknown claim is refused before the engine runs, so the live binding
    // must survive untouched.
    expect(record.pendingClaimVerify.get(teamId)?.claimId).toBe(claim.id);
  });
});

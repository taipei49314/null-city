import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

/**
 * M8 regression: completed runs are immutable at the *transport* layer.
 *
 * `packages/simulation/test/finalization.test.ts` already proved the engine
 * refuses post-completion commands, and that was mistaken for the whole
 * invariant. It was not: `sessionCommand` kept going after the engine's
 * refusal and appended a `CommandResult` player event, which moved
 * `playerLogHash`, the player event count and the exported artifact hash after
 * the terminal event. These tests attack the public surface, so they fail
 * against that inherited behaviour.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

interface Fingerprint {
  tick: number;
  phase: string;
  score: number;
  playerLogHash: string;
  playerEventCount: number;
  eventCount: number;
}

async function getJson(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function completeRun(sessionId: string): Promise<void> {
  await getJson("/sessions", "POST", { scenarioId: "black-river", seed: 49314, sessionId });
  for (let guard = 0; guard < 10; guard += 1) {
    const advanced = await getJson(`/sessions/${sessionId}/advance`, "POST", { ticks: 540 });
    if (advanced.body.result.completed) {
      return;
    }
    if (advanced.body.result.advanced === 0) {
      break;
    }
  }
  throw new Error(`session ${sessionId} did not complete`);
}

async function fingerprint(sessionId: string): Promise<Fingerprint> {
  const state = (await getJson(`/sessions/${sessionId}/state`)).body.result;
  const events = (await getJson(`/sessions/${sessionId}/events?since=0`)).body.result;
  return {
    tick: state.tick,
    phase: state.phase,
    score: state.score,
    playerLogHash: state.playerLogHash,
    playerEventCount: state.state.playerEventCount,
    eventCount: events.events.length,
  };
}

describe("completed runs are immutable over the public transport", () => {
  it("rejects a post-completion command without appending a player event", async () => {
    const sessionId = "m8-immutable-command";
    await completeRun(sessionId);
    const before = await fingerprint(sessionId);
    expect(before.phase).toBe("completed");

    const response = await getJson(`/sessions/${sessionId}/command`, "POST", {
      commandName: "DISPATCH_TEAM",
      idempotencyKey: "m8-post-complete",
      params: { teamId: "power-1", target: "industrial", task: "power_repair" },
    });

    expect(response.body.result.state).toBe("rejected");
    expect(response.body.result.validation.errorCode).toBe("run_completed");
    expect(response.body.result.events).toEqual([]);
    expect(await fingerprint(sessionId)).toEqual(before);
  });

  it("rejects a post-completion REQUEST_VERIFICATION without touching the verification queue", async () => {
    const sessionId = "m8-immutable-verify";
    await completeRun(sessionId);
    const before = await fingerprint(sessionId);
    const claims = (await getJson(`/sessions/${sessionId}/state`)).body.result.state.claims;

    const response = await getJson(`/sessions/${sessionId}/command`, "POST", {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "m8-post-complete-verify",
      params: { claimId: claims[0]?.id ?? "claim-x", teamId: "verify-1" },
    });

    expect(response.body.result.state).toBe("rejected");
    expect(await fingerprint(sessionId)).toEqual(before);
  });

  it("keeps the exported artifact byte-identical across mutation attempts", async () => {
    const sessionId = "m8-immutable-artifact";
    await completeRun(sessionId);

    const first = await fetch(`${ctx.baseUrl}/sessions/${sessionId}/artifact`).then((r) => r.text());

    for (const commandName of ["DISPATCH_TEAM", "CLOSE_ROUTE", "ISSUE_PUBLIC_ADVISORY"]) {
      await getJson(`/sessions/${sessionId}/command`, "POST", {
        commandName,
        idempotencyKey: `m8-artifact-${commandName}`,
        params: { teamId: "power-1", target: "industrial", task: "power_repair" },
      });
    }
    await getJson(`/sessions/${sessionId}/advance`, "POST", { ticks: 100 });
    await getJson(`/sessions/${sessionId}/assess`, "POST", {
      claimId: "claim-x",
      probability: 0.9,
      confidence: 0.9,
    });

    const second = await fetch(`${ctx.baseUrl}/sessions/${sessionId}/artifact`).then((r) => r.text());
    expect(second).toBe(first);
  });

  it("leaves the terminal event last in the player log", async () => {
    const sessionId = "m8-immutable-terminal";
    await completeRun(sessionId);

    await getJson(`/sessions/${sessionId}/command`, "POST", {
      commandName: "CLOSE_ROUTE",
      idempotencyKey: "m8-terminal-probe",
      params: { route: "r-central-industrial" },
    });

    const events = (await getJson(`/sessions/${sessionId}/events?since=0`)).body.result.events;
    expect(events[events.length - 1].kind).toBe("RunCompleted");
    expect(events.filter((event: { kind: string }) => event.kind === "RunCompleted")).toHaveLength(1);
  });
});

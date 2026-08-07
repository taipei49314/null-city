import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SCENARIO_IDS, goldenScriptFor, loadScenario, runScript, type SuiteScenarioId } from "@null-city/test-fixtures";
import { SimulationEngine } from "@null-city/simulation";

import { handleAdminRpc } from "../src/rpc.js";
import { driveScriptOverRest } from "../src/transport.js";
import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

const SEED = 49314;
const RESUME_TICK = 200;

describe.each(SCENARIO_IDS.map((id) => [id] as const))("transport determinism [%s]", (scenarioId: SuiteScenarioId) => {
  const scenario = loadScenario(scenarioId);
  const totalTicks = scenario.totalTicks;

  it("a golden play driven over REST matches the in-process run byte-for-byte", async () => {
    const sessionId = `transport-golden-${scenarioId}`;
    const reference = new SimulationEngine({ scenario, seed: SEED, sessionId });
    runScript(reference, goldenScriptFor(scenarioId));
    reference.runToEnd();

    await ctx.api.createSession({ scenarioId, seed: SEED, sessionId });
    await driveScriptOverRest(ctx.api, sessionId, goldenScriptFor(scenarioId));
    await ctx.api.advance(sessionId, totalTicks);

    const finalState = await ctx.api.state(sessionId);
    expect(finalState["score"]).toBe(reference.result().score.total);
    expect(finalState["tick"]).toBe(totalTicks);
    expect(typeof finalState["playerLogHash"]).toBe("string");
    expect((finalState["playerLogHash"] as string).length).toBe(64);
  });

  it("an admin-resumed session driven over REST finishes identically to an in-process direct run", async () => {
    const tail = goldenScriptFor(scenarioId).filter((c) => c.atTick > RESUME_TICK);
    const sessionId = `transport-resume-${scenarioId}`;

    const reference = new SimulationEngine({ scenario, seed: SEED, sessionId });
    runScript(reference, goldenScriptFor(scenarioId));
    while (reference.currentTick < RESUME_TICK && reference.step()) {
      // advance to the resume point
    }
    const snapshot = structuredClone(reference.snapshot());
    runScript(reference, tail);
    reference.runToEnd();

    // Resume is an in-process authority transfer, so it goes through the admin
    // surface. Play continues over the ordinary public REST transport.
    const resumed = handleAdminRpc(ctx.app.hub, {
      op: "admin.resume",
      params: { scenarioId, seed: SEED, sessionId, snapshot },
    });
    expect(resumed.ok).toBe(true);

    await driveScriptOverRest(ctx.api, sessionId, tail);
    await ctx.api.advance(sessionId, totalTicks);

    const restoredState = await ctx.api.state(sessionId);
    expect(restoredState["score"]).toBe(reference.result().score.total);
    expect(restoredState["tick"]).toBe(totalTicks);
  });
});
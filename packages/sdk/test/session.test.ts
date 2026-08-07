import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type NullCityServer } from "@null-city/server";
import { SimulationEngine } from "@null-city/simulation";
import { blackRiver, goldenScript, runScript } from "@null-city/test-fixtures";

import { createPlayerSession } from "../src/session.js";
import { ApiError } from "../src/errors.js";

const SEED = 49314;
const TOTAL_TICKS = 540;

describe("createPlayerSession — full lifecycle over the real public REST surface", () => {
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

  it("drives a golden script to the same score/tick as a direct in-process engine run", async () => {
    const reference = new SimulationEngine({ scenario: blackRiver(), seed: SEED, sessionId: "sdk-reference" });
    runScript(reference, goldenScript());
    reference.runToEnd();
    const referenceResult = reference.result();

    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    expect(session.scenarioId).toBe("black-river");
    expect(session.seed).toBe(SEED);

    const { toPublicCommand } = await import("./publicCommands.js");
    let tick = 0;
    for (const command of goldenScript()) {
      if (command.atTick > tick) {
        const advanced = await session.advance(command.atTick - tick);
        tick = advanced.tick;
      }
      const mapped = await toPublicCommand(session, command.commandName, command.params);
      const outcome = await session.submitCommand({
        commandName: mapped.commandName,
        params: mapped.params,
        idempotencyKey: command.idempotencyKey,
      });
      expect(outcome.state).toBe("accepted");
      expect(outcome.deduplicated).toBe(false);
    }

    for (;;) {
      const advanced = await session.advance(TOTAL_TICKS);
      tick = advanced.tick;
      if (advanced.completed) {
        break;
      }
    }

    const state = await session.getState();
    expect(state.score.total).toBe(referenceResult.score.total);
    expect(state.tick).toBe(referenceResult.finalTick);
    expect(state.phase).toBe("completed");

    const summary = await session.getCompletedRun();
    expect(summary).not.toBeNull();
    expect(summary?.scoreTotal).toBe(referenceResult.score.total);
    expect(summary?.finalTick).toBe(referenceResult.finalTick);

    await session.close();
  });

  it("getCompletedRun() returns null while the run is still active", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    await session.advance(5);
    expect(await session.getCompletedRun()).toBeNull();
  });

  it("getEvents(afterSequence) returns only events strictly after the given sequence", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    await session.advance(20);
    const all = await session.getEvents(0);
    expect(all.length).toBeGreaterThan(0);
    const tail = await session.getEvents(all.length - 1);
    expect(tail.length).toBe(1);
    expect(tail[0]!.sequence).toBe(all.length - 1);
  });

  it("submitAssessment rejects out-of-range probability/confidence before hitting the network", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    await expect(
      session.submitAssessment({ claimId: "whatever", probability: 1.5, confidence: 0.5 }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects an unknown session id with a not_found ApiError", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });
    await session.close();
    // A closed session refuses further local calls without any network round-trip.
    await expect(session.getState()).rejects.toBeInstanceOf(ApiError);
  });

  it("two sessions created with the same scenario/seed are independently deterministic", async () => {
    const a = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED, sessionId: "det-a" });
    const b = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED, sessionId: "det-b" });
    await session_playGolden(a);
    await session_playGolden(b);
    const stateA = await a.getState();
    const stateB = await b.getState();
    expect(stateA.score.total).toBe(stateB.score.total);
    expect(stateA.tick).toBe(stateB.tick);
  });
});

async function session_playGolden(session: Awaited<ReturnType<typeof createPlayerSession>>): Promise<void> {
  const { toPublicCommand } = await import("./publicCommands.js");
  let tick = 0;
  for (const command of goldenScript()) {
    if (command.atTick > tick) {
      const advanced = await session.advance(command.atTick - tick);
      tick = advanced.tick;
    }
    const mapped = await toPublicCommand(session, command.commandName, command.params);
    await session.submitCommand({
      commandName: mapped.commandName,
      params: mapped.params,
      idempotencyKey: command.idempotencyKey,
    });
  }
  for (;;) {
    const advanced = await session.advance(TOTAL_TICKS);
    if (advanced.completed) {
      break;
    }
  }
}

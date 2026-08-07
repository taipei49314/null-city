import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type NullCityServer } from "@null-city/server";
import { detectPublicLeak } from "@null-city/epistemics";
import { goldenScript } from "@null-city/test-fixtures";

import { createPlayerSession } from "../src/session.js";

const SEED = 49314;

/**
 * `@null-city/epistemics` is a **dev**-only dependency here, used solely
 * to scan wire payloads for truth-leak markers in tests — exactly the
 * pattern `packages/simulation` established for M4's artifact tests. It
 * is not imported anywhere in `src/` (enforced by `forbidden-imports.test.ts`).
 */
describe("no truth leaks through the SDK's public payloads", () => {
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

  it("state, events, command, advance, and assess payloads are all leak-free across a full run", async () => {
    const session = await createPlayerSession({ baseUrl, scenarioId: "black-river", seed: SEED });

    const { toPublicCommand } = await import("./publicCommands.js");
    let tick = 0;
    for (const command of goldenScript()) {
      if (command.atTick > tick) {
        const advanced = await session.advance(command.atTick - tick);
        expect(detectPublicLeak(advanced)).toBeNull();
        tick = advanced.tick;
      }
      const mapped = await toPublicCommand(session, command.commandName, command.params);
      const outcome = await session.submitCommand({
        commandName: mapped.commandName,
        params: mapped.params,
        idempotencyKey: command.idempotencyKey,
      });
      expect(detectPublicLeak(outcome)).toBeNull();
    }

    for (;;) {
      const advanced = await session.advance(540);
      expect(detectPublicLeak(advanced)).toBeNull();
      if (advanced.completed) {
        break;
      }
    }

    const state = await session.getState();
    expect(detectPublicLeak(state)).toBeNull();

    const events = await session.getEvents(0);
    expect(detectPublicLeak(events)).toBeNull();

    const summary = await session.getCompletedRun();
    expect(detectPublicLeak(summary)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type NullCityServer } from "@null-city/server";
import { createPlayerSession, type PlayerSession } from "@null-city/sdk";
import { detectPublicLeak } from "@null-city/epistemics";
import { goldenScript } from "@null-city/test-fixtures";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerNullCityTools } from "../src/tools.js";

const SEED = 49314;

/**
 * `@null-city/epistemics` is a **dev**-only dependency here, used solely to
 * scan MCP tool-call payloads for truth-leak markers — the same pattern the
 * SDK's own `leak.test.ts` uses. It is never imported from `src/`
 * (enforced by `forbidden-imports.test.ts`).
 */
describe("no truth leaks through MCP tool payloads", () => {
  let app: NullCityServer;
  let session: PlayerSession;
  let mcpServer: McpServer;
  let client: Client;

  beforeEach(async () => {
    app = createServer();
    const port = await app.listen(0, "127.0.0.1");
    session = await createPlayerSession({ baseUrl: `http://127.0.0.1:${port}`, scenarioId: "black-river", seed: SEED });

    mcpServer = new McpServer({ name: "null-city-mcp-leak-test", version: "0.0.0" });
    registerNullCityTools(mcpServer, session);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "leak-test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcpServer.server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
    await session.close();
    await app.close();
  });

  it("every tool response across a full golden-script run is leak-free", async () => {
    let tick = 0;
    for (const command of goldenScript()) {
      if (command.atTick > tick) {
        const advanced = await client.callTool({ name: "advance_time", arguments: { ticks: command.atTick - tick } });
        expect(detectPublicLeak(advanced)).toBeNull();
        tick = command.atTick;
      }
      const outcome = await client.callTool({
        name: "submit_command",
        arguments: {
          commandName: command.commandName,
          params: command.params,
          idempotencyKey: command.idempotencyKey,
        },
      });
      expect(detectPublicLeak(outcome)).toBeNull();
    }

    for (;;) {
      const advanced = await client.callTool({ name: "advance_time", arguments: { ticks: 540 } });
      expect(detectPublicLeak(advanced)).toBeNull();
      const state = JSON.parse((advanced.content as Array<{ text: string }>)[0]!.text);
      if (state.completed) {
        break;
      }
    }

    const state = await client.callTool({ name: "get_state", arguments: {} });
    expect(detectPublicLeak(state)).toBeNull();

    const events = await client.callTool({ name: "get_events", arguments: { afterSequence: 0, limit: 200 } });
    expect(detectPublicLeak(events)).toBeNull();

    const claims = await client.callTool({ name: "list_claims", arguments: {} });
    expect(detectPublicLeak(claims)).toBeNull();

    const teams = await client.callTool({ name: "list_teams", arguments: {} });
    expect(detectPublicLeak(teams)).toBeNull();

    const routes = await client.callTool({ name: "list_routes", arguments: {} });
    expect(detectPublicLeak(routes)).toBeNull();

    const summary = await client.callTool({ name: "get_completed_summary", arguments: {} });
    expect(detectPublicLeak(summary)).toBeNull();
    const summaryJson = JSON.parse((summary.content as Array<{ text: string }>)[0]!.text);
    expect(summaryJson.completed).toBe(true);
  });
});

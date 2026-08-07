#!/usr/bin/env node
/**
 * Runnable, non-LLM demonstration of the MCP adapter: spins up a real
 * `@null-city/server` on a loopback port, builds a NullCity MCP server
 * bound to one `black-river`/49314 session, connects a real MCP `Client`
 * to it over an in-memory transport, and drives the run to completion
 * using *only* MCP tool calls (`list_teams`, `submit_command`,
 * `advance_time`, `list_claims`, `submit_assessment`,
 * `get_completed_summary`) — exactly what an LLM tool-caller would do,
 * minus the LLM.
 *
 * Run after `pnpm build` at the repo root:
 *   node packages/mcp-server/examples/quickstart.mjs
 */
import { createServer } from "@null-city/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createNullCityMcpServer } from "../dist/server.js";

function parseText(result) {
  if (result.isError) {
    throw new Error(`tool error: ${result.content[0]?.text ?? "unknown"}`);
  }
  return JSON.parse(result.content[0].text);
}

async function main() {
  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;

  // createNullCityMcpServer is the same factory the CLI (`bin/null-city-mcp`) uses.
  const instance = await createNullCityMcpServer({
    baseUrl,
    scenarioId: "black-river",
    seed: 49314,
    sessionId: "mcp-quickstart",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "quickstart-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), instance.server.server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  console.log(`Discovered ${tools.length} tools:`, tools.map((t) => t.name).join(", "));

  let key = 0;
  const nextKey = () => `quickstart-${(key += 1)}`;

  const teams = parseText(await client.callTool({ name: "list_teams", arguments: {} }));
  const power = teams.teams.find((t) => t.teamId === "power-1");
  if (power) {
    await client.callTool({
      name: "submit_command",
      arguments: {
        commandName: "DISPATCH_TEAM",
        params: { teamId: "power-1", target: "industrial", task: "power_repair" },
        idempotencyKey: nextKey(),
      },
    });
  }

  for (;;) {
    const advanced = parseText(await client.callTool({ name: "advance_time", arguments: { ticks: 20 } }));
    if (advanced.completed) {
      break;
    }
    const claims = parseText(await client.callTool({ name: "list_claims", arguments: { status: "reported", limit: 5 } }));
    for (const claim of claims.claims) {
      await client.callTool({
        name: "submit_assessment",
        arguments: { claimId: claim.id, probability: 0.6, confidence: 0.5, rationale: "quickstart-heuristic" },
      });
    }
  }

  const summary = parseText(await client.callTool({ name: "get_completed_summary", arguments: {} }));
  console.log("=== MCP quickstart ===");
  console.log(`session   : ${instance.session.sessionId}`);
  console.log(`finalTick : ${summary.finalTick}`);
  console.log(`score     : ${summary.scoreTotal}`);
  console.log(`claims    : ${summary.claimCount}`);
  console.log("PASS mcp quickstart completed a full run using only MCP tool calls");

  await client.close();
  await instance.close();
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

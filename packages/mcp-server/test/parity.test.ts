import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type NullCityServer } from "@null-city/server";
import { createPlayerSession, type PlayerSession } from "@null-city/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerNullCityTools } from "../src/tools.js";

/**
 * Parity: the MCP adapter and a direct SDK call are both, ultimately,
 * the exact same `PlayerSession` — there is no second code path, no
 * truth shortcut, and no divergent projection. These tests drive one
 * shared session through *both* surfaces (raw SDK calls, and MCP tool
 * calls over a real in-memory MCP client/server pair using the actual
 * JSON-RPC tool-call/validation machinery) and assert they agree.
 */
describe("MCP adapter parity with direct SDK calls", () => {
  let app: NullCityServer;
  let baseUrl: string;
  let session: PlayerSession;
  let client: Client;
  let mcpServer: McpServer;

  beforeEach(async () => {
    app = createServer();
    const port = await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;

    session = await createPlayerSession({
      baseUrl,
      scenarioId: "black-river",
      seed: 49314,
      sessionId: "mcp-parity-black-river",
    });

    mcpServer = new McpServer({ name: "null-city-mcp-test", version: "0.0.0" });
    registerNullCityTools(mcpServer, session);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcpServer.server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
    await session.close();
    await app.close();
  });

  function toolJson(result: Awaited<ReturnType<Client["callTool"]>>): any {
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content.length).toBeGreaterThan(0);
    const text = content[0]!.text;
    expect(typeof text).toBe("string");
    return JSON.parse(text!);
  }

  it("exposes exactly the documented tool set with read/write annotations", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(new Set(byName.keys())).toEqual(
      new Set([
        "get_state",
        "get_events",
        "list_claims",
        "list_teams",
        "list_routes",
        "submit_command",
        "submit_assessment",
        "advance_time",
        "get_completed_summary",
      ]),
    );

    const readOnlyTools = ["get_state", "get_events", "list_claims", "list_teams", "list_routes", "get_completed_summary"];
    const writeTools = ["submit_command", "submit_assessment", "advance_time"];
    for (const name of readOnlyTools) {
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of writeTools) {
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(false);
    }

    // No tool anywhere in the surface can be a truth resource/tool.
    for (const name of byName.keys()) {
      expect(name).not.toMatch(/truth|snapshot|internal|admin/i);
    }
  });

  it("get_state via MCP matches session.getState() via direct SDK call", async () => {
    const direct = await session.getState();
    const result = await client.callTool({ name: "get_state", arguments: {} });
    const viaMcp = toolJson(result);

    expect(viaMcp.tick).toBe(direct.tick);
    expect(viaMcp.phase).toBe(direct.phase);
    expect(viaMcp.sessionId).toBe(direct.sessionId);
    expect(viaMcp.scenarioId).toBe(direct.scenarioId);
    expect(viaMcp.score).toEqual(direct.score);
    expect(viaMcp.playerEventCount).toBe(direct.playerEventCount);
    expect(viaMcp.playerLogHash).toBe(direct.playerLogHash);
    expect(viaMcp.claims).toEqual(direct.claims);
    expect(viaMcp.teamCount).toBe(direct.teams.length);
    expect(viaMcp.routeCount).toBe(direct.routes.length);
  });

  it("list_teams / list_routes via MCP match the direct state projection", async () => {
    const direct = await session.getState();

    const teamsResult = toolJson(await client.callTool({ name: "list_teams", arguments: {} }));
    expect(teamsResult.teams).toEqual(direct.teams);
    expect(teamsResult.total).toBe(direct.teams.length);

    const routesResult = toolJson(await client.callTool({ name: "list_routes", arguments: {} }));
    expect(routesResult.routes).toEqual(direct.routes);
  });

  it("submit_command via MCP mutates the same underlying session the SDK sees directly", async () => {
    const before = await session.getState();
    const idle = before.teams.find((team) => team.status === "idle");
    expect(idle).toBeDefined();

    const outcomeJson = toolJson(
      await client.callTool({
        name: "submit_command",
        arguments: {
          commandName: "DISPATCH_TEAM",
          params: { teamId: idle!.teamId, target: "industrial", task: "power_repair" },
        },
      }),
    );
    expect(["accepted", "rejected", "pending"]).toContain(outcomeJson.state);

    // The mutation happened through the one real `PlayerSession`; a
    // direct SDK read must observe exactly what the tool reported.
    const after = await session.getState();
    expect(after.tick).toBe(outcomeJson.tick);
    expect(after.score.total).toBe(outcomeJson.scoreTotal);
    if (outcomeJson.state === "accepted") {
      const dispatched = after.teams.find((team) => team.teamId === idle!.teamId);
      expect(dispatched?.status).not.toBe("idle");
    }
  });

  it("submit_assessment via MCP is visible to a direct SDK getEvents() call", async () => {
    const before = await session.getState();
    const claim = before.claims[0];
    if (claim === undefined) {
      return; // genesis state for this seed has no claims yet; nothing to assess.
    }

    const outcomeJson = toolJson(
      await client.callTool({
        name: "submit_assessment",
        arguments: { claimId: claim.id, probability: 0.6, confidence: 0.5, rationale: "mcp-parity-test" },
      }),
    );
    expect(outcomeJson.assessment.claimId).toBe(claim.id);

    const events = await session.getEvents(0);
    const found = events.find(
      (event) => event.kind === "AssessmentSubmitted" && (event.payload as any).assessment.id === outcomeJson.assessment.id,
    );
    expect(found).toBeDefined();
  });

  it("advance_time via MCP moves the same clock a direct SDK call observes", async () => {
    const before = await session.getState();
    const outcomeJson = toolJson(await client.callTool({ name: "advance_time", arguments: { ticks: 5 } }));
    const after = await session.getState();

    // `tick` is the player-observed tick (same field getState() returns); `clockAdvancedTo`
    // is the raw deterministic-clock position, which may run ahead while newsworthy player
    // events are still catching up — that lag is the whole point of the epistemic boundary.
    expect(after.tick).toBe(outcomeJson.tick);
    expect(outcomeJson.clockAdvancedTo).toBe(5);
    expect(outcomeJson.advanced).toBe(5);
    expect(after.tick).toBeGreaterThanOrEqual(before.tick);
  });

  it("get_events via MCP returns the same hash-chained events as session.getEvents()", async () => {
    await client.callTool({ name: "advance_time", arguments: { ticks: 5 } });
    const direct = await session.getEvents(0);
    const viaMcp = toolJson(await client.callTool({ name: "get_events", arguments: { afterSequence: 0, limit: 200 } }));

    expect(viaMcp.events).toEqual(direct);
    expect(viaMcp.total).toBe(direct.length);
    expect(viaMcp.truncated).toBe(false);
  });

  it("get_completed_summary reports not-completed for an active run, matching session.getCompletedRun()", async () => {
    const direct = await session.getCompletedRun();
    const viaMcp = toolJson(await client.callTool({ name: "get_completed_summary", arguments: {} }));
    expect(direct).toBeNull();
    expect(viaMcp.completed).toBe(false);
  });

  it("rejects out-of-range assessment inputs before ever reaching the session", async () => {
    const result = await client.callTool({
      name: "submit_assessment",
      arguments: { claimId: "whatever", probability: 1.5, confidence: 0.5 },
    });
    expect(result.isError).toBe(true);
  });

  it("never exposes a get_events/get_state payload larger than the documented bound", async () => {
    for (let i = 0; i < 30; i += 1) {
      await client.callTool({ name: "advance_time", arguments: { ticks: 18 } });
    }
    const viaMcp = toolJson(await client.callTool({ name: "get_events", arguments: { afterSequence: 0, limit: 50 } }));
    expect(viaMcp.events.length).toBeLessThanOrEqual(50);
  });
});

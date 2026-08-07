import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPlayerSession, type PlayerSession } from "@null-city/sdk";

import type { McpConnectionConfig } from "./config.js";
import { registerNullCityTools } from "./tools.js";

export interface NullCityMcpServer {
  readonly server: McpServer;
  readonly session: PlayerSession;
  close(): Promise<void>;
}

/**
 * Builds an MCP server bound to a single `PlayerSession`, created against
 * the given connection config exactly the way the SDK/CLI/benchmark would.
 * The returned `McpServer` is not yet connected to a transport — callers
 * (the CLI, or a test harness) choose how it is exposed.
 */
export async function createNullCityMcpServer(config: McpConnectionConfig): Promise<NullCityMcpServer> {
  const session = await createPlayerSession({
    baseUrl: config.baseUrl,
    scenarioId: config.scenarioId,
    seed: config.seed,
    ...(config.sessionId === undefined ? {} : { sessionId: config.sessionId }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
  });

  const server = new McpServer({ name: "null-city-mcp", version: "0.1.0" });
  registerNullCityTools(server, session);

  return {
    server,
    session,
    async close() {
      await server.close();
      await session.close();
    },
  };
}

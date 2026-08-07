#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { readConfigFromEnv } from "./config.js";
import { createNullCityMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = readConfigFromEnv();
  const instance = await createNullCityMcpServer(config);

  process.stderr.write(
    `null-city-mcp: connected to ${config.baseUrl} session=${instance.session.sessionId} ` +
      `scenario=${instance.session.scenarioId} seed=${instance.session.seed}\n`,
  );

  const transport = new StdioServerTransport();
  await instance.server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  process.stderr.write(`null-city-mcp: fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

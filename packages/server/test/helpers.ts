import type { NullCityServer } from "../src/index.js";
import { createServer } from "../src/index.js";
import { restClient, type RestApi } from "../src/transport.js";

export interface TestContext {
  app: NullCityServer;
  baseUrl: string;
  api: RestApi;
}

export async function startTestServer(): Promise<TestContext> {
  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;
  return { app, baseUrl, api: restClient(baseUrl) };
}

export async function stopTestServer(ctx: TestContext): Promise<void> {
  await ctx.app.close();
}
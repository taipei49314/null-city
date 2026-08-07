import { createServer as createHttpServer, type Server } from "node:http";

import { SessionHub } from "./hub.js";
import { attachHttp } from "./http.js";
import { attachWs } from "./ws.js";
import { compileScenarioLoader, defaultScenarioLoader, type ScenarioLoader } from "./scenarios.js";

export * from "./hub.js";
export * from "./rpc.js";
export * from "./http.js";
export * from "./ws.js";
export * from "./scenarios.js";
export * from "./player-view.js";
export * from "./player-events.js";
export * from "./artifact.js";
export * from "./transport.js";

export interface ServerOptions {
  scenarioLoader?: ScenarioLoader;
}

export interface NullCityServer {
  server: Server;
  hub: SessionHub;
  /** actual bound address, available after listen() */
  port: number;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/**
 * Creates a NULL CITY server: one shared scenario loader, a session hub,
 * REST + WebSocket surfaces. The engine itself is never touched by
 * wall-clock time, so every run stays deterministic.
 */
export function createServer(options: ServerOptions = {}): NullCityServer {
  const scenarioLoader = compileScenarioLoader(options.scenarioLoader ?? defaultScenarioLoader);
  const hub = new SessionHub(scenarioLoader);
  const server = createHttpServer();
  attachHttp(server, hub);
  const closeWs = attachWs(server, hub);

  const instance: NullCityServer = {
    server,
    hub,
    port: 0,
    listen: (port = 0, host = "127.0.0.1") =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          const bound = typeof address === "object" && address !== null ? address.port : port;
          instance.port = bound;
          resolve(bound);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        closeWs();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  return instance;
}
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containsForbiddenTruth } from "../src/player-events.js";
import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

describe("player transport truth containment (M1)", () => {
  it("REST public payloads never expose truth kinds or corruption flags", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 49314, sessionId: "leak-rest" });
    const advanced = await ctx.api.advance("leak-rest", 30);
    const events = await ctx.api.events("leak-rest", 0);
    const state = await ctx.api.state("leak-rest");
    const command = await ctx.api.command(
      "leak-rest",
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "industrial", task: "power_repair" },
      "leak-cmd-1",
    );

    for (const payload of [advanced, events, state, command]) {
      expect(containsForbiddenTruth(payload)).toBeNull();
    }

    const kinds = (events["events"] as Array<{ kind: string; stream?: string }>).map((event) => event.kind);
    expect(kinds).toContain("SessionStarted");
    expect(kinds).not.toContain("TrueIncidentOccurred");
    expect(kinds).not.toContain("SystemStateChanged");
    expect(kinds).not.toContain("ObservationCorrupted");
    expect((events["stream"] as string) ?? "player").toBe("player");
  });

  it("HTTP snapshot route is forbidden", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 1, sessionId: "leak-snap" });
    const response = await fetch(`${ctx.baseUrl}/sessions/leak-snap/snapshot`);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(containsForbiddenTruth(body)).toBeNull();
  });

  it("WebSocket hello/live events are player-stream only", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 49314, sessionId: "leak-ws" });
    const wsUrl = ctx.baseUrl.replace("http", "ws") + "/ws/leak-ws";
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("ws timeout")), 5000);
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", since: 0 }));
      });
      ws.on("message", (data) => {
        messages.push(JSON.parse(String(data)));
        if (messages.length >= 2) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });
      ws.on("error", () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      });
    });

    for (const message of messages) {
      expect(containsForbiddenTruth(message)).toBeNull();
    }
  });
});

import WebSocket from "ws";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestServer, stopTestServer, type TestContext } from "./helpers.js";

type Json = Record<string, unknown>;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

const wsUrl = (sessionId: string): string => `ws://127.0.0.1:${new URL(ctx.baseUrl).port}/ws/${sessionId}`;

interface WsTestClient {
  socket: WebSocket;
  send(message: Json): void;
  /** resolves the next server message matching the predicate, in arrival order */
  waitFor(predicate: (message: Json) => boolean): Promise<Json>;
}

function connect(sessionId: string): Promise<WsTestClient> {
  const socket = new WebSocket(wsUrl(sessionId));
  const queue: Json[] = [];
  const waiters: Array<{ predicate: (message: Json) => boolean; resolve: (message: Json) => void; reject: (error: Error) => void }> = [];

  return new Promise((resolve) => {
    socket.on("open", () => {
      resolve({
        socket,
        send: (message) => socket.send(JSON.stringify(message)),
        waitFor: (predicate) =>
          new Promise((resolveWait, rejectWait) => {
            const queuedIndex = queue.findIndex(predicate);
            if (queuedIndex >= 0) {
              resolveWait(queue.splice(queuedIndex, 1)[0] ?? {});
              return;
            }
            waiters.push({ predicate, resolve: resolveWait, reject: rejectWait });
          }),
      });
    });
    socket.on("error", () => {
      // connection failure surfaces as error + close
    });
    socket.on("close", () => {
      for (const waiter of waiters) {
        waiter.reject(new Error("socket closed before the message arrived"));
      }
    });
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Json;
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const waiter = waiters[waiterIndex]!;
        waiters.splice(waiterIndex, 1);
        waiter.resolve(message);
      } else {
        queue.push(message);
      }
    });
  });
}

describe("WebSocket surface", () => {
  it("greets a client and replays events since a cursor", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 100, sessionId: "ws-hello" });
    const client = await connect("ws-hello");
    try {
      client.send({ type: "hello", since: 0 });
      const hello = await client.waitFor((message) => message["type"] === "hello");
      expect(hello["sessionId"]).toBe("ws-hello");
      expect(hello["next"]).toBeGreaterThan(0);
      const events = await client.waitFor((message) => message["type"] === "events");
      const list = events["events"] as unknown[];
      expect(list.length).toBeGreaterThan(0);
      expect((list[0] as { kind: string }).kind).toBe("SessionStarted");
    } finally {
      client.socket.close();
    }
  });

  it("executes rpc over the socket and pushes subsequent events", async () => {
    await ctx.api.createSession({ scenarioId: "black-river", seed: 100, sessionId: "ws-rpc" });
    const client = await connect("ws-rpc");
    try {
      client.send({
        type: "rpc",
        requestId: "req-1",
        op: "session.command",
        params: {
          sessionId: "ws-rpc",
          commandName: "DISPATCH_TEAM",
          params: { teamId: "power-1", target: "industrial", task: "power_repair" },
          idempotencyKey: "ws-cmd-1",
        },
      });
      const reply = await client.waitFor((message) => message["type"] === "rpc-result");
      expect(reply["requestId"]).toBe("req-1");
      expect(reply["ok"]).toBe(true);
      const pushed = await client.waitFor((message) => message["type"] === "events");
      expect((pushed["events"] as unknown[]).length).toBeGreaterThan(0);

      // REST-triggered mutations are broadcast as player-redacted events only
      await ctx.api.advance("ws-rpc", 30);
      const pushed2 = await client.waitFor(
        (message) =>
          message["type"] === "events" &&
          message !== pushed &&
          Array.isArray(message["events"]) &&
          (message["events"] as unknown[]).length > 0,
      );
      const kinds = (pushed2["events"] as Array<{ kind: string; stream?: string }>).map((ev) => ev.kind);
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds).not.toContain("SystemStateChanged");
      expect(kinds).not.toContain("TrueIncidentOccurred");
      expect(kinds).not.toContain("IncidentChained");
      expect((pushed2["events"] as Array<{ stream?: string }>).every((ev) => ev.stream === "player")).toBe(true);
    } finally {
      client.socket.close();
    }
  });

  it("survives a non-string rpc op instead of crashing the process", async () => {
    // The admin gate calls `startsWith` on `op`, which is attacker-controlled
    // and need not be a string. An unguarded call threw inside the `message`
    // handler and took the server process down.
    await ctx.api.createSession({ scenarioId: "black-river", seed: 49314, sessionId: "ws-hostile-op" });
    const client = await connect("ws-hostile-op");
    try {
      client.send({ type: "rpc", op: 42 as unknown as string, requestId: "hostile", params: {} });
      const reply = await client.waitFor((m) => m["type"] === "rpc-result" && m["requestId"] === "hostile");
      expect(reply["ok"]).toBe(false);

      // The socket must still work afterwards.
      client.send({ type: "rpc", op: "session.state", requestId: "after", params: {} });
      const after = await client.waitFor((m) => m["type"] === "rpc-result" && m["requestId"] === "after");
      expect(after["ok"]).toBe(true);
    } finally {
      client.socket.close();
    }
  });

  it("rejects connections to unknown sessions", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl("does-not-exist"));
      const timer = setTimeout(() => reject(new Error("socket did not close")), 3000);
      socket.on("open", () => reject(new Error("connection must not open")));
      socket.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on("error", () => {
        // the server destroys the upgrade socket without handshaking
      });
    });
  });
});
import type { IncomingMessage, Server } from "node:http";
import type { PlayerEventEnvelope } from "@null-city/contracts";
import { WebSocket, WebSocketServer } from "ws";

import { SessionHub } from "./hub.js";
import { handleRpc, type RpcResult } from "./rpc.js";

/** Largest accepted inbound WebSocket frame. Mirrors the REST body bound. */
export const MAX_WS_PAYLOAD_BYTES = 1_048_576;

/**
 * Outbound buffer ceiling. A client that stops reading is dropped rather than
 * allowed to grow the server's send queue without bound.
 */
export const MAX_WS_BUFFERED_BYTES = 8 * 1_048_576;

interface WsIncoming {
  type: string;
  since?: number;
  requestId?: string;
  op?: string;
  params?: Record<string, unknown>;
}

/**
 * WebSocket player surface. Events are player-stream only.
 */
export function attachWs(server: Server, hub: SessionHub): () => void {
  // Protocol-size ceiling (P2-02): no legitimate player message is anywhere
  // near this, and an unbounded frame is a trivial memory-pressure vector.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  const cleanup = (): void => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  };

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    let sessionId: string;
    try {
      sessionId = decodeURIComponent(match[1]!);
    } catch {
      socket.destroy();
      return;
    }
    if (!hub.has(sessionId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, sessionId);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, sessionId: string) => {
    const unsubscribe = hub.subscribe(sessionId, (events) => {
      send(ws, { type: "events", sessionId, stream: "player", events: events as readonly PlayerEventEnvelope[] });
    });

    ws.on("message", (raw) => {
      let message: WsIncoming;
      try {
        const parsed: unknown = JSON.parse(raw.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          send(ws, {
            type: "error",
            error: { code: "invalid_message", message: "message must be a JSON object" },
          });
          return;
        }
        message = parsed as WsIncoming;
      } catch {
        send(ws, { type: "error", error: { code: "invalid_message", message: "message is not valid JSON" } });
        return;
      }
      if (message.type === "hello") {
        const since = Math.max(0, Math.trunc(message.since ?? 0));
        const record = hub.get(sessionId);
        if (!record) {
          ws.close();
          return;
        }
        const events = record.bridge.store.since(since);
        send(ws, { type: "hello", sessionId, stream: "player", next: record.bridge.store.length });
        send(ws, { type: "events", sessionId, stream: "player", events });
        return;
      }
      if (message.type === "rpc") {
        const params = { ...(message.params ?? {}) };
        if ("sessionId" in params && params["sessionId"] !== sessionId) {
          send(ws, {
            type: "rpc-result",
            sessionId,
            requestId: message.requestId ?? null,
            ok: false,
            error: { code: "forbidden", message: "sessionId does not match websocket session" },
          });
          return;
        }
        params["sessionId"] = sessionId;
        // `op` is attacker-controlled and need not be a string at all, so it is
        // narrowed before any string method is called on it.
        const op = typeof message.op === "string" ? message.op : "";
        if (op.startsWith("admin.") || op === "session.snapshot") {
          send(ws, {
            type: "rpc-result",
            sessionId,
            requestId: message.requestId ?? null,
            ok: false,
            error: { code: "forbidden", message: "admin operations are not available on the player websocket" },
          });
          return;
        }
        // Always the public surface: raw snapshot resume is rejected inside
        // `handleRpc` regardless of what the client puts in `params`.
        const result: RpcResult = handleRpc(hub, { op, params }, "public");
        const reply: Record<string, unknown> = {
          type: "rpc-result",
          sessionId,
          requestId: message.requestId ?? null,
        };
        if (result.ok) {
          reply["ok"] = true;
          reply["result"] = result.result;
        } else {
          reply["ok"] = false;
          reply["error"] = result.error;
        }
        send(ws, reply);
        return;
      }
      send(ws, {
        type: "error",
        error: { code: "unknown_message", message: `unknown message type ${JSON.stringify(message.type)}` },
      });
    });

    ws.on("close", () => {
      unsubscribe();
    });
  });

  return cleanup;
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
    // Slow-client policy: a subscriber that cannot keep up is terminated
    // instead of being allowed to hold an unbounded outbound queue.
    ws.terminate();
    return;
  }
  ws.send(JSON.stringify(payload));
}

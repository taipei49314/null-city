import { WebSocket } from "ws";
import { playerEventEnvelopeSchema } from "./schemas.js";
import type { PlayerEventEnvelope } from "@null-city/contracts";

export interface EventSubscription {
  close(): void;
}

export interface SubscribeEventsOptions {
  /** ws:// or wss:// base, e.g. `ws://127.0.0.1:8787`. */
  wsBaseUrl: string;
  sessionId: string;
  /** Replay events from this sequence on connect. Default 0. */
  since?: number;
  onEvents: (events: PlayerEventEnvelope[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Optional push-based alternative to polling `getEvents`. Connects to the
 * same `/ws/:sessionId` player surface the browser uses, replays from
 * `since` via a `hello` message, and forwards every subsequent `events`
 * message after runtime-validating each envelope. Never sends or accepts
 * `admin.snapshot` / `session.snapshot` — those are rejected server-side
 * on this socket regardless.
 */
export function subscribeEvents(options: SubscribeEventsOptions): EventSubscription {
  const url = `${options.wsBaseUrl.replace(/\/+$/, "")}/ws/${encodeURIComponent(options.sessionId)}`;
  const socket = new WebSocket(url);

  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "hello", since: options.since ?? 0 }));
  });

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      options.onError?.(new Error("received non-JSON websocket message"));
      return;
    }
    const message = parsed as { type?: string; events?: unknown[] };
    if (message.type !== "events" && message.type !== "hello") {
      return;
    }
    if (!Array.isArray(message.events) || message.events.length === 0) {
      return;
    }
    const validated: PlayerEventEnvelope[] = [];
    for (const raw of message.events) {
      const result = playerEventEnvelopeSchema.safeParse(raw);
      if (!result.success) {
        options.onError?.(new Error(`server sent an event that failed validation: ${result.error.message}`));
        return;
      }
      validated.push(result.data as PlayerEventEnvelope);
    }
    options.onEvents(validated);
  });

  socket.on("error", (error) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    close: () => {
      socket.close();
    },
  };
}

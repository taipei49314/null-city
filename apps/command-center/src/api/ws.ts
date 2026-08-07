import type { PlayerEventEnvelope } from "@null-city/contracts";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

interface WsEventsMessage {
  type: "events";
  sessionId: string;
  stream: "player";
  events: PlayerEventEnvelope[];
}

interface WsHelloMessage {
  type: "hello";
  sessionId: string;
  stream: "player";
  next: number;
}

interface WsErrorMessage {
  type: "error";
  error: { code: string; message: string };
}

interface WsRpcResultMessage {
  type: "rpc-result";
  sessionId: string;
  requestId: string | null;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

type WsMessage = WsEventsMessage | WsHelloMessage | WsErrorMessage | WsRpcResultMessage;

export interface SessionSocketHandlers {
  onEvents?: (events: PlayerEventEnvelope[]) => void;
  onState?: (state: ConnectionState) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export interface SessionSocket {
  close(): void;
  state(): ConnectionState;
}

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 8000;

/**
 * Opens the player websocket for a session (`/ws/:sessionId`), sends the
 * `hello` handshake, and streams player-only events to the caller. Retries
 * with backoff on unexpected disconnects until `close()` is called.
 */
export function openSessionSocket(sessionId: string, handlers: SessionSocketHandlers): SessionSocket {
  let closedByCaller = false;
  let socket: WebSocket | null = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let currentState: ConnectionState = "connecting";

  const setState = (next: ConnectionState): void => {
    currentState = next;
    handlers.onState?.(next);
  };

  const wsUrl = (): string => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/${encodeURIComponent(sessionId)}`;
  };

  const connect = (): void => {
    setState(currentState === "closed" ? "connecting" : currentState === "open" ? "reconnecting" : "connecting");
    const ws = new WebSocket(wsUrl());
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectDelay = RECONNECT_DELAY_MS;
      setState("open");
      ws.send(JSON.stringify({ type: "hello", since: 0 }));
    });

    ws.addEventListener("message", (event: MessageEvent<string>) => {
      let message: WsMessage;
      try {
        message = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }
      if (message.type === "events") {
        handlers.onEvents?.(message.events);
      } else if (message.type === "error") {
        handlers.onError?.(message.error);
      } else if (message.type === "rpc-result" && !message.ok && message.error) {
        handlers.onError?.(message.error);
      }
    });

    const scheduleReconnect = (): void => {
      if (closedByCaller) {
        setState("closed");
        return;
      }
      setState("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.6, MAX_RECONNECT_DELAY_MS);
        connect();
      }, reconnectDelay);
    };

    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", () => {
      handlers.onError?.({ code: "ws_error", message: "websocket connection error" });
    });
  };

  connect();

  return {
    close: () => {
      closedByCaller = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
      setState("closed");
    },
    state: () => currentState,
  };
}

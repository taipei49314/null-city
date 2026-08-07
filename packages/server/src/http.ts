import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { SessionHub } from "./hub.js";
import { handleRpc, type RpcResult } from "./rpc.js";

const MAX_BODY_BYTES = 1_048_576;
/** Upper bound on bytes read purely to resynchronise an over-long request. */
const MAX_DRAIN_BYTES = 16 * MAX_BODY_BYTES;

/**
 * Attaches the JSON REST surface to an http server.
 *
 * Routes:
 *   POST   /sessions                 create a session (a `resume` body field is rejected 403)
 *   GET    /sessions                 list session ids
 *   GET    /sessions/:id/state       player view + summary
 *   GET    /sessions/:id/events      incremental events (?since=seq)
 *   POST   /sessions/:id/command     submit a command
 *   POST   /sessions/:id/advance     advance tick(s)
 *   POST   /sessions/:id/assess      submit a claim assessment
 *   GET    /sessions/:id/summary     completed-run public summary
 *   GET    /sessions/:id/artifact    completed-run artifact export (403/409 while running)
 *   DELETE /sessions/:id
 *   GET    /health
 *
 * Raw engine snapshots are intentionally omitted from the player HTTP surface,
 * and so is snapshot resume: every call below goes through `handleRpc` on the
 * `public` surface, which refuses `admin.*` and any caller-supplied `resume`.
 */
export function attachHttp(server: Server, hub: SessionHub): void {
  server.on("request", (req, res) => {
    void handleRequest(req, res, hub);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, hub: SessionHub): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/health" && method === "GET") {
      return sendJson(res, 200, { ok: true, name: "@null-city/server" });
    }

    if (segments.length === 1 && segments[0] === "sessions") {
      if (method === "POST") {
        const body = await readJson(req);
        return rpcRespond(res, handleRpc(hub, { op: "session.create", params: body }, "public"));
      }
      if (method === "GET") {
        return rpcRespond(res, handleRpc(hub, { op: "session.list", params: {} }));
      }
      return methodNotAllowed(res);
    }

    // The addressed session always comes from the URL. Every `params` object
    // below therefore spreads the body *first* and sets `sessionId` last, so a
    // body field can never redirect an operation onto a different session —
    // the same rule the WebSocket transport enforces explicitly.
    if (segments.length >= 2 && segments[0] === "sessions") {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(segments[1]!);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: { code: "invalid_params", message: "session id in the path is not valid percent-encoding" },
        });
      }
      const sub = segments[2];

      if (!sub && method === "DELETE") {
        return rpcRespond(res, handleRpc(hub, { op: "session.delete", params: { sessionId } }));
      }

      if (sub === "state") {
        if (method !== "GET") {
          return methodNotAllowed(res);
        }
        return rpcRespond(res, handleRpc(hub, { op: "session.state", params: { sessionId } }));
      }

      if (sub === "events") {
        if (method !== "GET") {
          return methodNotAllowed(res);
        }
        const since = url.searchParams.get("since");
        const params: Record<string, unknown> = { sessionId };
        if (since !== null) {
          params["since"] = Number(since);
        }
        return rpcRespond(res, handleRpc(hub, { op: "session.events", params }));
      }

      if (sub === "command") {
        if (method !== "POST") {
          return methodNotAllowed(res);
        }
        const body = await readJson(req);
        return rpcRespond(res, handleRpc(hub, { op: "session.command", params: { ...body, sessionId } }));
      }

      if (sub === "advance") {
        if (method !== "POST") {
          return methodNotAllowed(res);
        }
        const body = await readJson(req);
        return rpcRespond(res, handleRpc(hub, { op: "session.advance", params: { ...body, sessionId } }));
      }

      if (sub === "assess") {
        if (method !== "POST") {
          return methodNotAllowed(res);
        }
        const body = await readJson(req);
        return rpcRespond(res, handleRpc(hub, { op: "session.assess", params: { ...body, sessionId } }));
      }

      if (sub === "summary") {
        if (method !== "GET") {
          return methodNotAllowed(res);
        }
        return rpcRespond(res, handleRpc(hub, { op: "session.summary", params: { sessionId } }));
      }

      if (sub === "artifact") {
        if (method !== "GET") {
          return methodNotAllowed(res);
        }
        return rpcRespond(res, handleRpc(hub, { op: "session.artifact", params: { sessionId } }));
      }

      if (sub === "snapshot") {
        return sendJson(res, 403, {
          ok: false,
          error: {
            code: "forbidden",
            message: "raw snapshots are not available on the player transport",
          },
        });
      }
    }

    return sendJson(res, 404, { ok: false, error: { code: "not_found", message: "no route" } });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      const payload = { ok: false, error: { code: "payload_too_large", message: error.message } };
      // A drained request left the connection synchronised, so it can be
      // reused. An undrained one did not: closing is the only way to stop the
      // unread remainder being parsed as the next request on that socket.
      return error.drained ? sendJson(res, 413, payload) : sendJsonAndClose(res, 413, payload);
    }
    if (error instanceof BodyError) {
      return sendJson(res, 400, { ok: false, error: { code: "invalid_body", message: error.message } });
    }
    return sendJson(res, 500, {
      ok: false,
      error: { code: "internal_error", message: error instanceof Error ? error.message : "internal error" },
    });
  }
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { ok: false, error: { code: "method_not_allowed", message: "method not allowed" } });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

/** Sends a final response and tears the connection down rather than reusing it. */
function sendJsonAndClose(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    connection: "close",
  });
  res.end(json, () => {
    res.socket?.destroy();
  });
}

function rpcRespond(res: ServerResponse, result: RpcResult): void {
  if (result.ok) {
    sendJson(res, 200, result);
    return;
  }
  const status =
    result.error.code === "not_found"
      ? 404
      : result.error.code === "conflict" || result.error.code === "not_completed"
        ? 409
        : result.error.code === "forbidden"
          ? 403
          : result.error.code === "invalid_params"
            ? 400
            : 400;
  sendJson(res, status, result);
}

/**
 * Reads and parses a JSON request body.
 *
 * Once the body passes `MAX_BODY_BYTES` nothing further is buffered, but the
 * remaining bytes are still drained so the connection stays synchronised and
 * the caller can actually read the 413. Draining is itself bounded by
 * `MAX_DRAIN_BYTES`: past that the sender is treated as hostile and the socket
 * is torn down instead.
 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_DRAIN_BYTES) {
      throw new BodyTooLargeError(
        `request body exceeds the ${MAX_BODY_BYTES} byte limit`,
        /* drained */ false,
      );
    }
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk as Buffer);
  }
  if (tooLarge) {
    throw new BodyTooLargeError(`request body exceeds the ${MAX_BODY_BYTES} byte limit`, /* drained */ true);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed: unknown = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BodyError("request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyError) {
      throw error;
    }
    throw new BodyError("request body is not valid JSON");
  }
}

class BodyError extends Error {}

/** Body exceeded `MAX_BODY_BYTES`. `drained` records whether the connection is still usable. */
class BodyTooLargeError extends BodyError {
  readonly drained: boolean;
  constructor(message: string, drained: boolean) {
    super(message);
    this.drained = drained;
  }
}
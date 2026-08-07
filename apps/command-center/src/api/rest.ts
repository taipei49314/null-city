import {
  ApiError,
  type AdvanceResult,
  type AssessResult,
  type CommandRequest,
  type CommandResult,
  type CreateSessionResult,
  type EventsResult,
  type SessionStateResult,
  type SummaryResult,
} from "./types";

interface Envelope {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/**
 * Thin fetch wrapper against the public `/api` surface (proxied to the
 * `@null-city/server` REST transport). Mirrors `packages/server/src/transport.ts`
 * `restClient`, but scoped to the browser's same-origin `/api` prefix so no
 * server URL or credentials are ever hard-coded into the client bundle.
 */
async function send(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError("network_error", error instanceof Error ? error.message : "network request failed");
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError("invalid_response", `non-JSON response from server (status ${response.status})`);
  }
  const envelope = parsed as Envelope;
  if (!response.ok || !envelope.ok) {
    const error = envelope.error ?? { code: "server_error", message: `request failed with status ${response.status}` };
    throw new ApiError(error.code, error.message);
  }
  return envelope.result ?? {};
}

function cast<T>(result: Promise<Record<string, unknown>>): Promise<T> {
  return result as unknown as Promise<T>;
}

export const restApi = {
  createSession: (params: { scenarioId: string; seed: number; sessionId?: string }) =>
    cast<CreateSessionResult>(send("POST", "/sessions", params)),

  state: (sessionId: string) =>
    cast<SessionStateResult>(send("GET", `/sessions/${encodeURIComponent(sessionId)}/state`)),

  events: (sessionId: string, since: number) =>
    cast<EventsResult>(send("GET", `/sessions/${encodeURIComponent(sessionId)}/events?since=${since}`)),

  command: (sessionId: string, request: CommandRequest) =>
    cast<CommandResult>(send("POST", `/sessions/${encodeURIComponent(sessionId)}/command`, request)),

  advance: (sessionId: string, ticks: number) =>
    cast<AdvanceResult>(send("POST", `/sessions/${encodeURIComponent(sessionId)}/advance`, { ticks })),

  assess: (sessionId: string, claimId: string, probability: number, confidence: number, rationale?: string) =>
    cast<AssessResult>(
      send("POST", `/sessions/${encodeURIComponent(sessionId)}/assess`, {
        claimId,
        probability,
        confidence,
        rationale,
      }),
    ),

  summary: (sessionId: string) =>
    cast<SummaryResult>(send("GET", `/sessions/${encodeURIComponent(sessionId)}/summary`)),

  /**
   * Fetches the raw JSON *text* of a completed run's artifact export,
   * rather than a parsed/typed object. Replay Lab runs its own strict,
   * bounded-size parser (`replay/schema.ts`) over this text — it must
   * never trust `JSON.parse` + a TypeScript cast on server input.
   */
  artifactRaw: async (sessionId: string): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifact`);
    } catch (error) {
      throw new ApiError("network_error", error instanceof Error ? error.message : "network request failed");
    }
    const text = await response.text();
    if (!response.ok) {
      let code = "server_error";
      let message = `request failed with status ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { code: string; message: string } };
        if (parsed.error) {
          code = parsed.error.code;
          message = parsed.error.message;
        }
      } catch {
        // fall through to generic message
      }
      throw new ApiError(code, message);
    }
    return text;
  },
};

export type RestApi = typeof restApi;

import type { ScriptedCommand } from "@null-city/test-fixtures";

export interface RestApi {
  createSession(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  state(sessionId: string): Promise<Record<string, unknown>>;
  events(sessionId: string, since: number): Promise<Record<string, unknown>>;
  command(
    sessionId: string,
    commandName: string,
    params: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>>;
  advance(sessionId: string, ticks: number): Promise<Record<string, unknown>>;
  assess(
    sessionId: string,
    claimId: string,
    probability: number,
    confidence: number,
    rationale?: string,
  ): Promise<Record<string, unknown>>;
  summary(sessionId: string): Promise<Record<string, unknown>>;
  del(sessionId: string): Promise<Record<string, unknown>>;
  list(): Promise<Record<string, unknown>>;
}

export function restClient(baseUrl: string): RestApi {
  async function send(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed: unknown = await response.json();
    const envelope = parsed as { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } };
    if (!response.ok || !envelope.ok) {
      throw new Error(`rest ${method} ${path} failed: ${JSON.stringify(envelope.error ?? envelope)}`);
    }
    return (envelope.result ?? {}) as Record<string, unknown>;
  }

  return {
    createSession: (params) => send("POST", "/sessions", params),
    state: (sessionId) => send("GET", `/sessions/${encodeURIComponent(sessionId)}/state`),
    events: (sessionId, since) => send("GET", `/sessions/${encodeURIComponent(sessionId)}/events?since=${since}`),
    command: (sessionId, commandName, params, idempotencyKey) =>
      send("POST", `/sessions/${encodeURIComponent(sessionId)}/command`, { commandName, params, idempotencyKey }),
    advance: (sessionId, ticks) => send("POST", `/sessions/${encodeURIComponent(sessionId)}/advance`, { ticks }),
    assess: (sessionId, claimId, probability, confidence, rationale) =>
      send("POST", `/sessions/${encodeURIComponent(sessionId)}/assess`, {
        claimId,
        probability,
        confidence,
        rationale,
      }),
    summary: (sessionId) => send("GET", `/sessions/${encodeURIComponent(sessionId)}/summary`),
    del: (sessionId) => send("DELETE", `/sessions/${encodeURIComponent(sessionId)}`),
    list: () => send("GET", "/sessions"),
  };
}

export interface DriveResult {
  tick: number;
}

/**
 * Translates legacy engine-oriented `{ teamId, target }` verification params
 * into the public `{ teamId, claimId }` contract by resolving a live claim in
 * the target district. Scripts that already send `claimId` pass through.
 */
async function toPublicCommand(
  api: RestApi,
  sessionId: string,
  commandName: string,
  params: Record<string, unknown>,
): Promise<{ commandName: string; params: Record<string, unknown> }> {
  if (commandName !== "REQUEST_VERIFICATION") {
    return { commandName, params };
  }
  if (typeof params["claimId"] === "string" && params["claimId"].length > 0) {
    const { target: _ignored, ...rest } = params;
    void _ignored;
    return { commandName: "REQUEST_VERIFICATION", params: rest };
  }
  const target = typeof params["target"] === "string" ? params["target"] : undefined;
  const teamId = params["teamId"];
  if (!target || typeof teamId !== "string") {
    return { commandName, params };
  }
  const snapshot = await api.state(sessionId);
  const publicState = snapshot["state"] as { claims?: Array<{ id: string; districtId?: string }> } | undefined;
  const claim = (publicState?.claims ?? []).find((item) => item.districtId === target);
  if (claim) {
    return { commandName: "REQUEST_VERIFICATION", params: { teamId, claimId: claim.id } };
  }
  // No claim has formed yet — district inspection without claim binding.
  return { commandName: "INSPECT_DISTRICT", params: { teamId, target } };
}

/**
 * Mirrors runScript() semantics over the REST transport: the engine is
 * advanced to each command's tick before the command is submitted, so the
 * transport-driven run and the in-process run are indistinguishable.
 *
 * REQUEST_VERIFICATION entries that still use the engine-level `target`
 * district form are rewritten to the public `claimId` contract.
 */
export async function driveScriptOverRest(
  api: RestApi,
  sessionId: string,
  script: ScriptedCommand[],
): Promise<DriveResult> {
  let tick = 0;
  for (const command of script) {
    if (command.atTick > tick) {
      const result = await api.advance(sessionId, command.atTick - tick);
      tick = (result["tick"] as number) ?? tick;
    }
    const mapped = await toPublicCommand(api, sessionId, command.commandName, command.params);
    await api.command(sessionId, mapped.commandName, mapped.params, command.idempotencyKey);
  }
  return { tick };
}
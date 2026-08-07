/**
 * A2 — session scoping and confused-deputy operations.
 *
 * NullCity is deliberately unauthenticated and local-first, so "session scope"
 * here means: an operation must act on exactly the session its transport
 * addressed, and must never be steerable onto a different session by payload
 * content. The WebSocket transport already enforces this explicitly, which
 * makes it the reference behaviour the REST transport is judged against.
 */

import { P0, P1, P2, openWs, publicSession, rest } from "./lib.mjs";

const CATEGORY = "session-scope";

export async function run(harness, findings) {
  const { base, wsBase } = harness;

  const victim = await publicSession(base, { ticks: 60, sessionId: "adv-victim" });
  const attacker = await publicSession(base, { ticks: 60, sessionId: "adv-attacker" });

  const victimBefore = (await rest(base, "GET", `/sessions/${victim}/state`)).json.result;

  // --- REST: does the body override the addressed session? -----------------
  const crossAdvance = await rest(base, "POST", `/sessions/${attacker}/advance`, {
    sessionId: victim,
    ticks: 30,
  });
  const victimAfterAdvance = (await rest(base, "GET", `/sessions/${victim}/state`)).json.result;
  const victimMoved = victimAfterAdvance.tick !== victimBefore.tick;

  findings.assert(
    "A2-01",
    CATEGORY,
    "REST advance cannot be redirected onto another session via the body",
    P1,
    "Session scope enforced (release gate D)",
    !victimMoved,
    victimMoved
      ? `POST /sessions/${attacker}/advance with body sessionId=${victim} advanced the victim ` +
        `from tick ${victimBefore.tick} to ${victimAfterAdvance.tick} ` +
        `(response reported sessionId=${crossAdvance.json?.result?.sessionId})`
      : `victim tick unchanged at ${victimAfterAdvance.tick}`,
  );

  const crossCommand = await rest(base, "POST", `/sessions/${attacker}/command`, {
    sessionId: victim,
    commandName: "DISPATCH_TEAM",
    idempotencyKey: "adv-cross-1",
    params: { teamId: "power-1", target: "industrial", task: "power_repair" },
  });
  const victimAfterCommand = (await rest(base, "GET", `/sessions/${victim}/state`)).json.result;
  const commandLanded =
    crossCommand.status === 200 && crossCommand.json?.result?.sessionId === victim;

  findings.assert(
    "A2-02",
    CATEGORY,
    "REST command cannot be redirected onto another session via the body",
    P1,
    "Session scope enforced (release gate D)",
    !commandLanded,
    commandLanded
      ? `POST /sessions/${attacker}/command with body sessionId=${victim} executed against the victim ` +
        `(victim playerLogHash now ${String(victimAfterCommand.playerLogHash).slice(0, 16)})`
      : `status=${crossCommand.status} resultSession=${crossCommand.json?.result?.sessionId}`,
  );

  const crossDelete = await rest(base, "DELETE", `/sessions/${attacker}`, undefined);
  void crossDelete;

  const crossAssess = await rest(base, "POST", `/sessions/${victim}/assess`, {
    sessionId: "adv-nonexistent",
    claimId: "whatever",
    probability: 0.5,
    confidence: 0.5,
  });
  findings.assert(
    "A2-03",
    CATEGORY,
    "REST assess cannot be redirected onto another session via the body",
    P1,
    "Session scope enforced (release gate D)",
    crossAssess.json?.error?.code !== "not_found",
    `status=${crossAssess.status} code=${crossAssess.json?.error?.code} ` +
      `(a not_found here proves the body's sessionId, not the URL's, selected the session)`,
  );

  // --- WebSocket: the reference behaviour ---------------------------------
  const wsVictim = await publicSession(base, { ticks: 60, sessionId: "adv-ws-victim" });
  const wsAttacker = await publicSession(base, { ticks: 60, sessionId: "adv-ws-attacker" });
  const ws = await openWs(wsBase, wsAttacker);

  ws.send({ type: "rpc", op: "session.state", requestId: "x", params: { sessionId: wsVictim } });
  const wsCross = await ws.next();
  findings.assert(
    "A2-04",
    CATEGORY,
    "WebSocket rpc rejects a mismatched sessionId in params",
    P0,
    "Session scope enforced (release gate D)",
    wsCross.ok === false && wsCross.error?.code === "forbidden",
    `reply=${JSON.stringify(wsCross.error ?? wsCross.result?.sessionId)}`,
  );

  ws.send({ type: "rpc", op: "session.list", requestId: "list", params: {} });
  const wsList = await ws.next();
  const listedOthers = Array.isArray(wsList.result?.sessions)
    ? wsList.result.sessions.filter((id) => id !== wsAttacker)
    : [];
  findings.accept(
    "A2-05",
    CATEGORY,
    "session.list enumerates every other live session to any client",
    P2,
    "session ids are not capabilities",
    listedOthers.length === 0,
    listedOthers.length === 0
      ? "no foreign sessions listed"
      : `a WS client scoped to ${wsAttacker} enumerated ${listedOthers.length} foreign session ids ` +
        `(${listedOthers.slice(0, 4).join(", ")})`,
    "GET /sessions is a documented endpoint of an unauthenticated, loopback-only, single-user tool: " +
      "any local process that can call it can already call every other endpoint. Session ids are " +
      "therefore identifiers, not capabilities. Adding authentication is explicitly a v0.1 non-goal " +
      "(00_NORTH_STAR.md). Recorded in docs/threat-model.md.",
  );

  await ws.close();

  // --- WebSocket upgrade to an unknown session ----------------------------
  let upgradeRejected = false;
  try {
    const ghost = await openWs(wsBase, "adv-session-that-does-not-exist");
    await ghost.close();
  } catch {
    upgradeRejected = true;
  }
  findings.assert(
    "A2-06",
    CATEGORY,
    "WebSocket upgrade for an unknown session is refused",
    P1,
    "no subscription to a session that does not exist",
    upgradeRejected,
    upgradeRejected ? "socket destroyed during upgrade" : "upgrade succeeded for a non-existent session",
  );

  // --- deleted session must stop serving ----------------------------------
  await rest(base, "DELETE", `/sessions/${wsVictim}`, undefined);
  const afterDelete = await rest(base, "GET", `/sessions/${wsVictim}/state`);
  findings.assert(
    "A2-07",
    CATEGORY,
    "a deleted session serves no further state",
    P1,
    "session lifecycle is honoured",
    afterDelete.status === 404,
    `status=${afterDelete.status}`,
  );

  // --- session id collision / takeover ------------------------------------
  const collide = await rest(base, "POST", "/sessions", {
    scenarioId: "black-river",
    seed: 49314,
    sessionId: victim,
  });
  findings.assert(
    "A2-08",
    CATEGORY,
    "creating a session with an in-use id cannot hijack the existing run",
    P0,
    "Session scope enforced (release gate D)",
    collide.status === 409 && collide.json?.error?.code === "conflict",
    `status=${collide.status} code=${collide.json?.error?.code}`,
  );
}

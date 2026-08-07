/**
 * A6 — failure isolation and bounded resource use.
 *
 * All exhaustion probes are deliberately bounded so this module stays inside a
 * normal CI budget; the point is to show the guards exist, not to benchmark
 * the host.
 */

import { createServer } from "../../packages/server/dist/index.js";

import { P0, P1, P2, P3, openWs, publicSession, rest } from "./lib.mjs";

const CATEGORY = "isolation-and-limits";

export async function run(harness, findings) {
  const { base, wsBase, hub } = harness;
  const sessionId = await publicSession(base, { ticks: 30, sessionId: "adv-isolation" });

  // --- subscriber failure isolation ---------------------------------------
  const delivered = [];
  let throwingCalls = 0;
  hub.subscribe(sessionId, () => {
    throwingCalls += 1;
    throw new Error("hostile subscriber");
  });
  hub.subscribe(sessionId, (events) => {
    delivered.push(events.length);
  });

  const advanceWithBadSubscriber = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 60 });
  findings.assert(
    "A6-01",
    CATEGORY,
    "a throwing subscriber does not break the request or the other subscribers",
    P0,
    "Error boundaries: subscriber failures isolated (release gate D)",
    advanceWithBadSubscriber.status === 200 && throwingCalls > 0 && delivered.length > 0,
    `status=${advanceWithBadSubscriber.status} hostileInvocations=${throwingCalls} ` +
      `healthySubscriberBatches=${delivered.length}`,
  );

  const healthAfterSubscriber = await rest(base, "GET", "/health");
  findings.assert(
    "A6-02",
    CATEGORY,
    "the server survives a throwing subscriber",
    P0,
    "Error boundaries (release gate D)",
    healthAfterSubscriber.status === 200,
    `status=${healthAfterSubscriber.status}`,
  );

  // --- bounded advance -----------------------------------------------------
  const bigAdvance = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 100000 });
  findings.assert(
    "A6-03",
    CATEGORY,
    "a single advance call cannot exceed the documented tick ceiling",
    P1,
    "Resource exhaustion safe: bounded advance limits (release gate C)",
    (bigAdvance.json?.result?.advanced ?? 0) <= 540,
    `requested 100000 ticks, advanced ${bigAdvance.json?.result?.advanced}`,
  );

  // --- events pagination bounds -------------------------------------------
  const sinceCases = [-1, 0, 1e9, Number.MAX_SAFE_INTEGER];
  const sinceProblems = [];
  for (const since of sinceCases) {
    const response = await rest(base, "GET", `/sessions/${sessionId}/events?since=${since}`);
    if (response.status !== 200 || !Array.isArray(response.json?.result?.events)) {
      sinceProblems.push(`since=${since} -> ${response.status}`);
    }
  }
  findings.assert(
    "A6-04",
    CATEGORY,
    "event pagination handles out-of-range cursors",
    P2,
    "bounded requests (release gate C)",
    sinceProblems.length === 0,
    sinceProblems.length === 0 ? `${sinceCases.length} cursors handled` : sinceProblems.join("; "),
  );

  // --- many concurrent WebSocket subscribers -------------------------------
  const sockets = [];
  for (let i = 0; i < 25; i += 1) {
    sockets.push(await openWs(wsBase, sessionId));
  }
  const advanceManySubs = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 30 });
  await Promise.all(sockets.map((socket) => socket.close()));
  findings.assert(
    "A6-05",
    CATEGORY,
    "25 concurrent WebSocket subscribers do not destabilise the session",
    P2,
    "Resource exhaustion safe (release gate C)",
    advanceManySubs.status === 200,
    `advance with 25 subscribers -> ${advanceManySubs.status}`,
  );

  // --- many sessions -------------------------------------------------------
  let created = 0;
  let firstFailure = null;
  for (let i = 0; i < 60; i += 1) {
    const response = await rest(base, "POST", "/sessions", {
      scenarioId: "black-river",
      seed: 1000 + i,
      sessionId: `adv-bulk-${i}`,
    });
    if (response.status === 200) {
      created += 1;
    } else if (firstFailure === null) {
      firstFailure = `${response.status} ${response.json?.error?.code}`;
    }
  }
  const healthAfterBulk = await rest(base, "GET", "/health");
  findings.assert(
    "A6-06",
    CATEGORY,
    "creating 60 concurrent sessions leaves the server healthy",
    P2,
    "Resource exhaustion safe (release gate C)",
    healthAfterBulk.status === 200,
    `created=${created}/60 firstFailure=${firstFailure ?? "none"} health=${healthAfterBulk.status}`,
  );

  findings.accept(
    "A6-07",
    CATEGORY,
    "the server enforces no ceiling on concurrent sessions",
    P3,
    "session creation is a bounded allocation path",
    created < 60,
    created < 60
      ? `session creation was capped after ${created}`
      : `all 60 sessions were accepted with no cap; each holds a full engine and event log in memory`,
    "Only reachable by a process already on the loopback interface, which can exhaust memory by " +
      "simpler means. A cap would break the benchmark matrix, which legitimately opens many sessions. " +
      "Revisit if a shared or hosted deployment is ever in scope (it is a v0.1 non-goal). " +
      "Recorded in docs/threat-model.md.",
  );

  // --- oversized body poisons the keep-alive connection --------------------
  const huge = JSON.stringify({ ticks: 1, filler: "A".repeat(2 * 1024 * 1024) });
  const oversized = await rest(base, "POST", `/sessions/${sessionId}/advance`, huge);
  let resetSeen = null;
  for (let i = 0; i < 12; i += 1) {
    const follow = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 1 });
    if (follow.status === 0) {
      resetSeen = `follow-up request ${i} failed with ${follow.text}`;
      break;
    }
  }
  findings.assert(
    "A6-08",
    CATEGORY,
    "an oversized body does not poison the keep-alive connection",
    P2,
    "Error boundaries (release gate D)",
    resetSeen === null,
    resetSeen === null
      ? `oversized -> ${oversized.status}, 12 follow-up requests all succeeded`
      : `after a rejected 2MB body (${oversized.status}), ${resetSeen}. The size guard stops reading ` +
        `mid-stream and replies without draining or closing, so the socket is left desynchronised and ` +
        `the next request reusing it is reset.`,
  );

  // --- graceful shutdown with idle keep-alive connections ------------------
  const shutdownApp = createServer();
  const shutdownPort = await shutdownApp.listen(0, "127.0.0.1");
  const shutdownBase = `http://127.0.0.1:${shutdownPort}`;
  await rest(shutdownBase, "GET", "/health");
  const closed = await Promise.race([
    shutdownApp.close().then(() => "closed"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 4000)),
  ]);
  if (closed === "timeout") {
    shutdownApp.server.closeAllConnections?.();
    await shutdownApp.close().catch(() => undefined);
  }
  findings.assert(
    "A6-09",
    CATEGORY,
    "close() completes while an idle keep-alive connection exists",
    P2,
    "Docker smoke: clean shutdown (release gate F)",
    closed === "closed",
    closed === "closed"
      ? "closed within 4s"
      : `close() did not resolve within 4s while one idle keep-alive client remained. ` +
        `NullCityServer.close() calls server.close() without closeIdleConnections()/closeAllConnections(), ` +
        `so a container stop or Ctrl-C waits for the OS keep-alive timeout instead of shutting down promptly.`,
  );

  // --- WebSocket flood -----------------------------------------------------
  const floodWs = await openWs(wsBase, sessionId);
  for (let i = 0; i < 200; i += 1) {
    floodWs.send({ type: "rpc", op: "session.state", requestId: `f${i}`, params: {} });
  }
  let floodReplies = 0;
  for (let i = 0; i < 200; i += 1) {
    try {
      await floodWs.next(5000);
      floodReplies += 1;
    } catch {
      break;
    }
  }
  await floodWs.close();
  const healthAfterFlood = await rest(base, "GET", "/health");
  findings.assert(
    "A6-10",
    CATEGORY,
    "a 200-message WebSocket burst is served without destabilising the server",
    P2,
    "Resource exhaustion safe (release gate C)",
    healthAfterFlood.status === 200 && floodReplies > 0,
    `replies=${floodReplies}/200 health=${healthAfterFlood.status}`,
  );

  // --- broadcast to a deleted session --------------------------------------
  const doomed = await publicSession(base, { ticks: 10, sessionId: "adv-doomed" });
  const doomedWs = await openWs(wsBase, doomed);
  await rest(base, "DELETE", `/sessions/${doomed}`, undefined);
  const healthAfterDelete = await rest(base, "GET", "/health");
  await doomedWs.close();
  findings.assert(
    "A6-11",
    CATEGORY,
    "deleting a session with a live subscriber does not crash the server",
    P1,
    "Error boundaries (release gate D)",
    healthAfterDelete.status === 200,
    `status=${healthAfterDelete.status}`,
  );
}

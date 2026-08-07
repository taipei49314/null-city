/**
 * A1 — truth extraction across every public surface.
 *
 * The oracle is built from the live in-process engine, so these checks compare
 * public payloads against the run's *actual* secrets (pre-corruption text,
 * undisclosed incident ids, district attribute values, prng state) instead of
 * against a denylist the implementation was written against.
 */

import { P0, P1, P2, P3, openWs, publicSession, rest, scanForTruth, truthOracle } from "./lib.mjs";

const CATEGORY = "truth-extraction";

export async function run(harness, findings) {
  const { base, wsBase, hub } = harness;

  const sessionId = await publicSession(base, { ticks: 180 });
  const oracle = truthOracle(hub, sessionId);

  // Sanity: the oracle must actually have secrets to look for, otherwise a
  // clean scan proves nothing.
  findings.assert(
    "A1-00",
    CATEGORY,
    "oracle has real secrets to hunt for (meta-check)",
    P1,
    "the leak oracle is non-vacuous",
    oracle.districtSecrets.length > 0 && oracle.truthEventCount > 20,
    `districtSecrets=${oracle.districtSecrets.length} truthEvents=${oracle.truthEventCount} ` +
      `corruptions=${oracle.corruptionSecrets.length} undisclosedIncidents=${oracle.undisclosedIncidentIds.length}`,
  );

  // --- REST surface -------------------------------------------------------
  const restProbes = [
    ["GET /health", await rest(base, "GET", "/health")],
    ["GET /sessions", await rest(base, "GET", "/sessions")],
    [`GET /sessions/:id/state`, await rest(base, "GET", `/sessions/${sessionId}/state`)],
    [`GET /sessions/:id/events`, await rest(base, "GET", `/sessions/${sessionId}/events?since=0`)],
    [`GET /sessions/:id/summary`, await rest(base, "GET", `/sessions/${sessionId}/summary`)],
    [`GET /sessions/:id/artifact`, await rest(base, "GET", `/sessions/${sessionId}/artifact`)],
    [`GET /sessions/:id/snapshot`, await rest(base, "GET", `/sessions/${sessionId}/snapshot`)],
    [`POST /sessions/:id/snapshot`, await rest(base, "POST", `/sessions/${sessionId}/snapshot`, {})],
    [`GET /sessions/:id/../state`, await rest(base, "GET", `/sessions/${sessionId}/state/extra`)],
  ];

  const restLeaks = [];
  for (const [label, response] of restProbes) {
    restLeaks.push(...scanForTruth(oracle, label, response.text));
  }
  findings.assert(
    "A1-01",
    CATEGORY,
    "REST endpoints leak no truth during an active run",
    P0,
    "No active-run truth leak (release gate A)",
    restLeaks.length === 0,
    restLeaks.length === 0 ? `${restProbes.length} REST responses clean` : restLeaks.join("; "),
  );

  const artifactActive = restProbes.find(([label]) => label.endsWith("/artifact"))[1];
  findings.assert(
    "A1-02",
    CATEGORY,
    "run artifact is withheld while the run is active",
    P0,
    "truth bundle only after completion",
    artifactActive.status === 409 && artifactActive.json?.error?.code === "not_completed",
    `status=${artifactActive.status} code=${artifactActive.json?.error?.code}`,
  );

  const snapshotRest = restProbes.find(([label]) => label === "GET /sessions/:id/snapshot")[1];
  findings.assert(
    "A1-03",
    CATEGORY,
    "raw engine snapshot is not exposed over REST",
    P0,
    "player transport carries no truth snapshot",
    snapshotRest.status === 403 && !snapshotRest.text.includes("prngState"),
    `status=${snapshotRest.status}`,
  );

  // --- WebSocket surface --------------------------------------------------
  // The op sweep includes destructive ops, so it runs against a throwaway
  // session; the main session must survive to be driven to completion below.
  const wsVictimId = await publicSession(base, { ticks: 120, sessionId: "adv-a1-ws-victim" });
  const ws = await openWs(wsBase, wsVictimId);
  const wsPayloads = [];

  ws.send({ type: "hello", since: 0 });
  wsPayloads.push(["ws hello", JSON.stringify(await ws.next())]);
  wsPayloads.push(["ws hello events", JSON.stringify(await ws.next())]);

  const wsOps = [
    "session.state",
    "session.events",
    "session.summary",
    "session.artifact",
    "session.list",
    "admin.snapshot",
    "session.snapshot",
    "session.create",
    "session.delete",
    "nope.not_an_op",
  ];
  const wsResults = {};
  for (const op of wsOps) {
    ws.send({ type: "rpc", op, requestId: op, params: {} });
    const reply = await ws.next();
    wsResults[op] = reply;
    wsPayloads.push([`ws rpc ${op}`, JSON.stringify(reply)]);
  }

  // Live broadcast delta pushed to a subscriber of the still-running session.
  const liveWs = await openWs(wsBase, sessionId);
  liveWs.send({ type: "hello", since: 0 });
  wsPayloads.push(["ws live hello", JSON.stringify(await liveWs.next())]);
  wsPayloads.push(["ws live backlog", JSON.stringify(await liveWs.next())]);
  await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 30 });
  try {
    wsPayloads.push(["ws broadcast", JSON.stringify(await liveWs.next(3000))]);
  } catch {
    wsPayloads.push(["ws broadcast", "<no broadcast within 3s>"]);
  }
  await liveWs.close();

  const wsLeaks = [];
  for (const [label, text] of wsPayloads) {
    wsLeaks.push(...scanForTruth(oracle, label, text));
  }
  findings.assert(
    "A1-04",
    CATEGORY,
    "WebSocket surface leaks no truth (events, rpc results, errors)",
    P0,
    "No active-run truth leak (release gate A)",
    wsLeaks.length === 0,
    wsLeaks.length === 0 ? `${wsPayloads.length} WS payloads clean` : wsLeaks.join("; "),
  );

  findings.assert(
    "A1-05",
    CATEGORY,
    "admin.snapshot is refused on the player WebSocket",
    P0,
    "no privileged truth op on a public transport",
    wsResults["admin.snapshot"]?.ok === false &&
      wsResults["admin.snapshot"]?.error?.code === "forbidden" &&
      !JSON.stringify(wsResults["admin.snapshot"]).includes("prngState"),
    `reply=${JSON.stringify(wsResults["admin.snapshot"])}`,
  );

  findings.assert(
    "A1-06",
    CATEGORY,
    "session.artifact over WS is withheld while active",
    P0,
    "truth bundle only after completion",
    wsResults["session.artifact"]?.ok === false &&
      wsResults["session.artifact"]?.error?.code === "not_completed",
    `reply=${JSON.stringify(wsResults["session.artifact"]?.error)}`,
  );

  await ws.close();

  // --- error/log channel --------------------------------------------------
  const errorProbes = [
    await rest(base, "POST", `/sessions/${sessionId}/command`, {
      commandName: "DISPATCH_TEAM",
      idempotencyKey: "err-1",
      params: { teamId: "does-not-exist", target: "does-not-exist", task: "power_repair" },
    }),
    await rest(base, "POST", `/sessions/${sessionId}/assess`, {
      claimId: "claim-does-not-exist",
      probability: 0.5,
      confidence: 0.5,
    }),
    await rest(base, "POST", `/sessions/${sessionId}/command`, {
      commandName: "REQUEST_VERIFICATION",
      idempotencyKey: "err-2",
      params: { claimId: "claim-nope", teamId: "verify-1" },
    }),
    await rest(base, "GET", "/sessions/not-a-session/state"),
    await rest(base, "POST", "/sessions", { scenarioId: "../../etc/passwd", seed: 1 }),
    await rest(base, "POST", "/sessions", { scenarioId: "black-river", seed: Number.NaN }),
  ];
  const errorLeaks = [];
  for (const [index, response] of errorProbes.entries()) {
    errorLeaks.push(...scanForTruth(oracle, `error-probe-${index}`, response.text));
  }
  findings.assert(
    "A1-07",
    CATEGORY,
    "error messages leak no truth",
    P1,
    "errors are actionable without disclosing truth",
    errorLeaks.length === 0,
    errorLeaks.length === 0 ? `${errorProbes.length} error bodies clean` : errorLeaks.join("; "),
  );

  const traversal = errorProbes[4];
  // Echoing the caller's own rejected input back is not disclosure; a real
  // leak here would be a resolved host path from the server's filesystem.
  const hostPathDisclosed = /[A-Za-z]:\\\\|node_modules|null-city[/\\]scenarios/.test(traversal.text);
  findings.assert(
    "A1-08",
    CATEGORY,
    "scenario id path traversal is rejected without host filesystem disclosure",
    P1,
    "scenario loader cannot escape scenarios/",
    traversal.status >= 400 && !hostPathDisclosed,
    `status=${traversal.status} body=${traversal.text.slice(0, 200)}`,
  );

  findings.assert(
    "A1-08b",
    CATEGORY,
    "rejected scenario id returns a classified error, not internal_error",
    P3,
    "Actionable errors (release gate E)",
    traversal.json?.error?.code === "invalid_params",
    `code=${traversal.json?.error?.code} status=${traversal.status}`,
  );

  // --- artifact timing side-channel ---------------------------------------
  // Coarse check only: an active-run /artifact rejection must not vary with how
  // much truth exists. JS wall-clock timing in a shared sandbox is noisy, so
  // this is reported as an observation, never as a cryptographic guarantee.
  const timings = [];
  for (let i = 0; i < 25; i += 1) {
    const started = process.hrtime.bigint();
    await rest(base, "GET", `/sessions/${sessionId}/artifact`);
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const mean = timings.reduce((sum, value) => sum + value, 0) / timings.length;
  findings.assert(
    "A1-09",
    CATEGORY,
    "active-run artifact rejection is a constant-shape refusal",
    P3,
    "artifact refusal reveals nothing about run contents",
    artifactActive.text.length < 300,
    `refusal body ${artifactActive.text.length} bytes, mean latency ${mean.toFixed(2)}ms over 25 calls ` +
      `(timing is indicative only, not a constant-time proof)`,
  );

  // --- completed run: truth is released only through the artifact ----------
  let completedId;
  for (let guard = 0; guard < 40; guard += 1) {
    const advanced = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 540 });
    if (advanced.json?.result?.completed) {
      completedId = sessionId;
      break;
    }
    if (advanced.json?.result?.advanced === 0) {
      break;
    }
  }

  if (!completedId) {
    findings.blocked(
      "A1-10",
      CATEGORY,
      "completed-run state endpoint still withholds truth",
      P1,
      "completion releases the artifact but not the live state view",
      "session did not reach completion",
    );
  } else {
    const finalOracle = truthOracle(hub, completedId);
    const stateAfter = await rest(base, "GET", `/sessions/${completedId}/state`);
    const summaryAfter = await rest(base, "GET", `/sessions/${completedId}/summary`);
    const eventsAfter = await rest(base, "GET", `/sessions/${completedId}/events?since=0`);
    const postLeaks = [
      ...scanForTruth(finalOracle, "completed state", stateAfter.text),
      ...scanForTruth(finalOracle, "completed summary", summaryAfter.text),
      ...scanForTruth(finalOracle, "completed events", eventsAfter.text),
    ];
    findings.assert(
      "A1-10",
      CATEGORY,
      "completed-run state/summary/events still carry no truth",
      P1,
      "completion releases the artifact but not the live player view",
      postLeaks.length === 0,
      postLeaks.length === 0 ? "3 completed-run responses clean" : postLeaks.join("; "),
    );

    const artifact = await rest(base, "GET", `/sessions/${completedId}/artifact`);
    findings.assert(
      "A1-11",
      CATEGORY,
      "completed run exports an artifact that does contain truth (positive control)",
      P1,
      "the leak scanner is capable of detecting truth when it is present",
      artifact.status === 200 && scanForTruth(finalOracle, "artifact", artifact.text).length > 0,
      `status=${artifact.status} detectedTruthMarkers=${scanForTruth(finalOracle, "artifact", artifact.text).length}`,
    );
  }

  return { sessionId };
}

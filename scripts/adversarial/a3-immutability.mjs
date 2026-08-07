/**
 * A3 — completed runs must be immutable.
 *
 * The invariant under attack: "Completed runs reject all mutation and preserve
 * terminal hashes, score, state, and event count." Every probe below runs
 * *after* the run has emitted its terminal event, and the oracle is the full
 * public fingerprint of the run (player log hash, event count, score, tick,
 * phase) plus the exported artifact bytes.
 */

import { P0, P1, P2, completedSession, openWs, rest } from "./lib.mjs";

const CATEGORY = "immutability";

async function fingerprint(base, sessionId) {
  const state = (await rest(base, "GET", `/sessions/${sessionId}/state`)).json.result;
  const events = (await rest(base, "GET", `/sessions/${sessionId}/events?since=0`)).json.result;
  return {
    tick: state.tick,
    phase: state.phase,
    score: state.score,
    playerLogHash: state.playerLogHash,
    playerEventCount: state.state.playerEventCount,
    eventsReturned: events.events.length,
    next: events.next,
  };
}

function diff(before, after) {
  const changed = [];
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(`${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
    }
  }
  return changed;
}

export async function run(harness, findings) {
  const { base, wsBase } = harness;

  const sessionId = await completedSession(base, { sessionId: "adv-complete" });
  const before = await fingerprint(base, sessionId);

  findings.assert(
    "A3-00",
    CATEGORY,
    "run reached a completed terminal state (meta-check)",
    P1,
    "the immutability probes act on a genuinely completed run",
    before.phase === "completed" && before.playerEventCount > 0,
    `phase=${before.phase} tick=${before.tick} playerEvents=${before.playerEventCount}`,
  );

  // --- post-completion command --------------------------------------------
  const command = await rest(base, "POST", `/sessions/${sessionId}/command`, {
    commandName: "DISPATCH_TEAM",
    idempotencyKey: "adv-post-complete-1",
    params: { teamId: "power-1", target: "industrial", task: "power_repair" },
  });
  const afterCommand = await fingerprint(base, sessionId);
  const commandDrift = diff(before, afterCommand);

  findings.assert(
    "A3-01",
    CATEGORY,
    "a command after completion does not mutate the run",
    P0,
    "Completed state immutable (release gate A)",
    commandDrift.length === 0,
    commandDrift.length === 0
      ? "no observable drift"
      : `POST /command after completion changed the public run fingerprint — ${commandDrift.join("; ")}`,
  );

  findings.assert(
    "A3-02",
    CATEGORY,
    "a command after completion is reported as rejected",
    P1,
    "Completed state immutable (release gate A)",
    command.json?.result?.state === "rejected" || command.json?.ok === false,
    `state=${command.json?.result?.state} code=${command.json?.result?.validation?.errorCode ?? command.json?.error?.code}`,
  );

  // --- post-completion REQUEST_VERIFICATION (separate mutation path) -------
  const beforeVerify = await fingerprint(base, sessionId);
  const claims = (await rest(base, "GET", `/sessions/${sessionId}/state`)).json.result.state.claims;
  const someClaim = claims[0]?.id;
  await rest(base, "POST", `/sessions/${sessionId}/command`, {
    commandName: "REQUEST_VERIFICATION",
    idempotencyKey: "adv-post-complete-verify",
    params: { claimId: someClaim ?? "claim-x", teamId: "verify-1" },
  });
  const afterVerify = await fingerprint(base, sessionId);
  const verifyDrift = diff(beforeVerify, afterVerify);
  findings.assert(
    "A3-03",
    CATEGORY,
    "REQUEST_VERIFICATION after completion does not mutate the run",
    P0,
    "Completed state immutable (release gate A)",
    verifyDrift.length === 0,
    verifyDrift.length === 0 ? "no observable drift" : verifyDrift.join("; "),
  );

  // --- post-completion assessment -----------------------------------------
  const beforeAssess = await fingerprint(base, sessionId);
  const assess = await rest(base, "POST", `/sessions/${sessionId}/assess`, {
    claimId: someClaim ?? "claim-x",
    probability: 0.99,
    confidence: 0.99,
  });
  const afterAssess = await fingerprint(base, sessionId);
  const assessDrift = diff(beforeAssess, afterAssess);
  findings.assert(
    "A3-04",
    CATEGORY,
    "an assessment after completion is rejected and mutates nothing",
    P0,
    "Completed state immutable (release gate A)",
    assess.json?.ok === false && assessDrift.length === 0,
    `status=${assess.status} code=${assess.json?.error?.code} drift=[${assessDrift.join("; ")}]`,
  );

  // --- post-completion advance --------------------------------------------
  const beforeAdvance = await fingerprint(base, sessionId);
  const advance = await rest(base, "POST", `/sessions/${sessionId}/advance`, { ticks: 100 });
  const afterAdvance = await fingerprint(base, sessionId);
  const advanceDrift = diff(beforeAdvance, afterAdvance);
  findings.assert(
    "A3-05",
    CATEGORY,
    "advancing a completed run is a no-op",
    P0,
    "Completed state immutable (release gate A)",
    advance.json?.result?.advanced === 0 && advanceDrift.length === 0,
    `advanced=${advance.json?.result?.advanced} drift=[${advanceDrift.join("; ")}]`,
  );

  // --- post-completion reconnect ------------------------------------------
  const beforeReconnect = await fingerprint(base, sessionId);
  const ws = await openWs(wsBase, sessionId);
  ws.send({ type: "hello", since: 0 });
  await ws.next();
  await ws.next();
  ws.send({
    type: "rpc",
    op: "session.command",
    requestId: "post",
    params: {
      commandName: "CLOSE_ROUTE",
      idempotencyKey: "adv-post-complete-ws",
      params: { route: "r-central-industrial" },
    },
  });
  await ws.next();
  await ws.close();
  const afterReconnect = await fingerprint(base, sessionId);
  const reconnectDrift = diff(beforeReconnect, afterReconnect);
  findings.assert(
    "A3-06",
    CATEGORY,
    "reconnecting and commanding over WebSocket after completion mutates nothing",
    P0,
    "Completed state immutable (release gate A)",
    reconnectDrift.length === 0,
    reconnectDrift.length === 0 ? "no observable drift" : reconnectDrift.join("; "),
  );

  // --- terminal event uniqueness ------------------------------------------
  const allEvents = (await rest(base, "GET", `/sessions/${sessionId}/events?since=0`)).json.result.events;
  const terminals = allEvents.filter((event) => event.kind === "RunCompleted");
  findings.assert(
    "A3-07",
    CATEGORY,
    "exactly one terminal player event exists after all mutation attempts",
    P0,
    "One terminal event/receipt (release gate A)",
    terminals.length === 1,
    `RunCompleted count=${terminals.length}`,
  );

  findings.assert(
    "A3-08",
    CATEGORY,
    "no player event is appended after the terminal event",
    P0,
    "One terminal event/receipt (release gate A)",
    allEvents.length > 0 && allEvents[allEvents.length - 1].kind === "RunCompleted",
    `last event kind=${allEvents[allEvents.length - 1]?.kind} at sequence ` +
      `${allEvents[allEvents.length - 1]?.sequence} of ${allEvents.length}`,
  );

  // --- artifact stability --------------------------------------------------
  const artifactA = await rest(base, "GET", `/sessions/${sessionId}/artifact`);
  await rest(base, "POST", `/sessions/${sessionId}/command`, {
    commandName: "CLOSE_ROUTE",
    idempotencyKey: "adv-post-complete-2",
    params: { route: "r-central-industrial" },
  });
  const artifactB = await rest(base, "GET", `/sessions/${sessionId}/artifact`);
  findings.assert(
    "A3-09",
    CATEGORY,
    "exported artifact is byte-identical across mutation attempts",
    P0,
    "terminal hashes are preserved (release gate A/B)",
    artifactA.status === 200 && artifactA.text === artifactB.text,
    artifactA.text === artifactB.text
      ? `identical, ${artifactA.text.length} bytes`
      : `artifact changed after a post-completion command ` +
        `(hashA=${artifactA.json?.result?.artifactHash} hashB=${artifactB.json?.result?.artifactHash})`,
  );

  // --- terminal score preservation ----------------------------------------
  const finalState = (await rest(base, "GET", `/sessions/${sessionId}/state`)).json.result;
  findings.assert(
    "A3-10",
    CATEGORY,
    "terminal score and tick survive every mutation attempt",
    P0,
    "Completed state immutable (release gate A)",
    finalState.score === before.score && finalState.tick === before.tick,
    `score ${before.score} -> ${finalState.score}, tick ${before.tick} -> ${finalState.tick}`,
  );

  // --- summary stability ---------------------------------------------------
  const summary = (await rest(base, "GET", `/sessions/${sessionId}/summary`)).json.result;
  findings.assert(
    "A3-11",
    CATEGORY,
    "completed-run summary matches the pre-attack fingerprint",
    P1,
    "Completed state immutable (release gate A)",
    summary.playerLogHash === before.playerLogHash && summary.finalTick === before.tick,
    `summary.playerLogHash=${String(summary.playerLogHash).slice(0, 16)} ` +
      `expected=${String(before.playerLogHash).slice(0, 16)}`,
  );
}

/**
 * A4 — snapshot binding, resume equivalence, and event-stream tampering.
 *
 * Snapshot/resume attacks run against the real engine; tamper attacks run
 * against the real artifact verifier. Each tamper mutates exactly one field so
 * a rejection can be attributed to that field and not to collateral damage.
 */

import { SimulationEngine, verifyRunArtifact } from "../../packages/simulation/dist/index.js";
import { loadScenario } from "../../packages/server/dist/scenarios.js";

import { P0, P1, P2, completedSession, rest } from "./lib.mjs";

const CATEGORY = "snapshot-and-tamper";

function newEngine(sessionId = "adv-engine", seed = 49314, scenarioId = "black-river") {
  return new SimulationEngine({ scenario: loadScenario(scenarioId), seed, sessionId });
}

function runToCompletion(engine) {
  while (engine.step()) {
    /* advance */
  }
  return engine;
}

function tryResume(snapshot, overrides = {}) {
  const options = {
    scenario: loadScenario(overrides.scenarioId ?? "black-river"),
    seed: overrides.seed ?? snapshot.seed,
    sessionId: overrides.sessionId ?? snapshot.sessionId,
    resume: snapshot,
  };
  try {
    return { ok: true, engine: new SimulationEngine(options) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function run(harness, findings) {
  const { base } = harness;

  // --- snapshot completeness: resume must be indistinguishable -------------
  const reference = newEngine("adv-snap-ref");
  for (let i = 0; i < 200; i += 1) {
    reference.step();
  }
  const midSnapshot = reference.snapshot();
  const midSnapshotBytes = JSON.stringify(midSnapshot);

  // Continue the original engine to the end.
  runToCompletion(reference);
  const referenceResult = reference.result();

  findings.assert(
    "A4-01",
    CATEGORY,
    "a taken snapshot is detached: the original engine continuing does not alter it",
    P0,
    "Snapshot immutability (release gate B)",
    JSON.stringify(midSnapshot) === midSnapshotBytes,
    JSON.stringify(midSnapshot) === midSnapshotBytes
      ? `snapshot stable across ${referenceResult.finalTick - 200} further ticks`
      : "snapshot mutated when the source engine advanced",
  );

  const resumed = tryResume(midSnapshot, { sessionId: "adv-snap-ref" });
  findings.assert(
    "A4-02",
    CATEGORY,
    "a valid snapshot resumes",
    P0,
    "Arbitrary snapshot/resume equivalence (release gate B)",
    resumed.ok,
    resumed.ok ? "resumed" : `rejected: ${resumed.message}`,
  );

  if (resumed.ok) {
    runToCompletion(resumed.engine);
    const resumedResult = resumed.engine.result();
    const equal =
      resumedResult.eventLogHash === referenceResult.eventLogHash &&
      resumedResult.finalStateDigest === referenceResult.finalStateDigest &&
      resumedResult.score.total === referenceResult.score.total &&
      resumedResult.eventCount === referenceResult.eventCount;
    findings.assert(
      "A4-03",
      CATEGORY,
      "resume-from-snapshot reaches a byte-identical terminal state",
      P0,
      "Arbitrary snapshot/resume equivalence (release gate B)",
      equal,
      equal
        ? `eventLogHash and stateDigest match across ${resumedResult.eventCount} events`
        : `divergence: hash ${resumedResult.eventLogHash === referenceResult.eventLogHash}, ` +
          `state ${resumedResult.finalStateDigest === referenceResult.finalStateDigest}, ` +
          `score ${resumedResult.score.total} vs ${referenceResult.score.total}`,
    );

    // Aliasing: mutating the caller's snapshot after resume must not reach the engine.
    const aliasEngine = tryResume(midSnapshot, { sessionId: "adv-snap-ref" });
    const stolen = aliasEngine.ok ? aliasEngine.engine : null;
    midSnapshot.world.resources.backupGenerators = 9999;
    midSnapshot.events.push({ kind: "forged" });
    const aliasSafe =
      stolen !== null &&
      stolen.worldState.resources.backupGenerators !== 9999 &&
      stolen.eventLog.every((event) => event.kind !== "forged");
    findings.assert(
      "A4-04",
      CATEGORY,
      "resumed engine does not alias the caller's snapshot object graph",
      P0,
      "Snapshots are detached values (core invariant)",
      aliasSafe,
      aliasSafe
        ? "post-resume mutation of the caller's snapshot had no effect"
        : "the engine observed a mutation applied to the caller's snapshot after construction",
    );
  }

  // --- identity binding ----------------------------------------------------
  const bindingSnapshot = newEngine("adv-bind");
  for (let i = 0; i < 50; i += 1) {
    bindingSnapshot.step();
  }
  const snap = bindingSnapshot.snapshot();

  const bindingCases = [
    ["A4-05", "session mismatch", { sessionId: "someone-elses-session" }],
    ["A4-06", "seed mismatch", { seed: 111 }],
    ["A4-07", "scenario mismatch", { scenarioId: "glass-harbor" }],
  ];
  for (const [id, label, overrides] of bindingCases) {
    const attempt = tryResume(snap, { sessionId: "adv-bind", ...overrides });
    findings.assert(
      id,
      CATEGORY,
      `resume rejects a snapshot with a ${label}`,
      P0,
      "Scenario digest binding (release gate B)",
      !attempt.ok,
      attempt.ok ? "ACCEPTED a mismatched snapshot" : `rejected: ${attempt.message}`,
    );
  }

  const versionSnap = { ...snap, version: 99, protocolVersion: 99 };
  const versionAttempt = tryResume(versionSnap, { sessionId: "adv-bind" });
  findings.assert(
    "A4-08",
    CATEGORY,
    "resume rejects an unsupported snapshot protocol version",
    P0,
    "Snapshots are versioned (core invariant)",
    !versionAttempt.ok,
    versionAttempt.ok ? "ACCEPTED an unsupported version" : `rejected: ${versionAttempt.message}`,
  );

  const digestSnap = { ...snap, scenarioDigest: "0".repeat(64) };
  const digestAttempt = tryResume(digestSnap, { sessionId: "adv-bind" });
  findings.assert(
    "A4-09",
    CATEGORY,
    "resume rejects a forged scenario digest",
    P0,
    "Scenario digest binding (release gate B)",
    !digestAttempt.ok,
    digestAttempt.ok ? "ACCEPTED a forged digest" : `rejected: ${digestAttempt.message}`,
  );

  const tickSnap = { ...snap, tick: snap.tick + 5 };
  const tickAttempt = tryResume(tickSnap, { sessionId: "adv-bind" });
  findings.assert(
    "A4-10",
    CATEGORY,
    "resume rejects a header tick that disagrees with world tick",
    P1,
    "snapshot internal consistency",
    !tickAttempt.ok,
    tickAttempt.ok ? "ACCEPTED an inconsistent tick" : `rejected: ${tickAttempt.message}`,
  );

  // Omission: a snapshot missing a future-output-affecting field must not
  // silently resume with a default.
  const omitted = { ...snap };
  delete omitted.firstActionTickByIncident;
  const omittedAttempt = tryResume(omitted, { sessionId: "adv-bind" });
  findings.assert(
    "A4-11",
    CATEGORY,
    "resume rejects a snapshot missing a scoring-relevant field",
    P1,
    "Every future-output-affecting field is in the snapshot (core invariant)",
    !omittedAttempt.ok,
    omittedAttempt.ok ? "ACCEPTED a snapshot with a missing field" : `rejected: ${omittedAttempt.message}`,
  );

  // --- snapshot injection through the *public* REST transport --------------
  const publicResume = await rest(base, "POST", "/sessions", {
    scenarioId: "black-river",
    seed: 49314,
    sessionId: "adv-public-resume",
    resume: { not: "a snapshot" },
  });
  findings.assert(
    "A4-12",
    CATEGORY,
    "public session create rejects a malformed resume payload",
    P1,
    "Runtime request validation (release gate D)",
    publicResume.status >= 400,
    `status=${publicResume.status} code=${publicResume.json?.error?.code}`,
  );

  const chainBroken = JSON.parse(JSON.stringify(snap));
  chainBroken.sessionId = "adv-public-chain";
  chainBroken.events[10].payload = { tampered: true };
  const publicChain = await rest(base, "POST", "/sessions", {
    scenarioId: "black-river",
    seed: 49314,
    sessionId: "adv-public-chain",
    resume: chainBroken,
  });
  findings.assert(
    "A4-13",
    CATEGORY,
    "public session create rejects a resume snapshot with a broken hash chain",
    P1,
    "Tamper rejection (release gate B)",
    publicChain.status >= 400,
    publicChain.status >= 400
      ? `status=${publicChain.status} code=${publicChain.json?.error?.code}`
      : `a snapshot whose embedded truth log fails its own hash chain was accepted over public REST ` +
        `and became a live session (sessionId=${publicChain.json?.result?.sessionId})`,
  );

  // --- artifact tampering --------------------------------------------------
  // Use a real completed session so the artifact carries both a genuine truth
  // log and a genuine player log, exactly as a released artifact would.
  const artifactSessionId = await completedSession(base, { sessionId: "adv-artifact" });
  const exported = await rest(base, "GET", `/sessions/${artifactSessionId}/artifact`);
  if (exported.status !== 200) {
    throw new Error(`could not export artifact fixture: ${exported.status} ${exported.text}`);
  }
  const baseArtifact = exported.json.result;

  findings.assert(
    "A4-14",
    CATEGORY,
    "an untampered artifact verifies (positive control)",
    P1,
    "the tamper detector is not simply rejecting everything",
    verifyRunArtifact(baseArtifact).ok,
    JSON.stringify(verifyRunArtifact(baseArtifact).reasons),
  );

  const tampers = [
    [
      "A4-15",
      "payload mutation",
      (artifact) => {
        artifact.truth.events[5].payload = { ...artifact.truth.events[5].payload, injected: true };
      },
    ],
    [
      "A4-16",
      "sequence gap",
      (artifact) => {
        artifact.truth.events.splice(7, 1);
      },
    ],
    [
      "A4-17",
      "tick rollback",
      (artifact) => {
        const target = artifact.truth.events[artifact.truth.events.length - 3];
        target.tick = 0;
      },
    ],
    [
      "A4-18",
      "session swap",
      (artifact) => {
        artifact.truth.events[4].sessionId = "other-session";
      },
    ],
    [
      "A4-19",
      "forged genesis anchor",
      (artifact) => {
        artifact.truth.events[0].previousHash = "f".repeat(64);
      },
    ],
    [
      "A4-20",
      "terminal event substitution",
      (artifact) => {
        const last = artifact.truth.events[artifact.truth.events.length - 1];
        last.payload = { ...last.payload, finalScore: { ...last.payload.finalScore, total: 9999 } };
      },
    ],
    [
      "A4-21",
      "terminal event removal",
      (artifact) => {
        artifact.truth.events.pop();
      },
    ],
    [
      "A4-22",
      "declared hash swap",
      (artifact) => {
        artifact.truthLogHash = "a".repeat(64);
      },
    ],
    [
      "A4-23",
      "score inflation in the header",
      (artifact) => {
        artifact.scoreTotal = 9999;
      },
    ],
    [
      "A4-24",
      "command trace injection",
      (artifact) => {
        artifact.commandTrace.push({
          sequence: 1,
          commandId: "cmd-forged",
          commandName: "DISPATCH_TEAM",
          idempotencyKey: "forged",
          issuedTick: 1,
          target: null,
          params: {},
          outcome: "accepted",
          errorCode: null,
          errorMessage: null,
          etaTick: null,
        });
      },
    ],
  ];

  for (const [id, label, mutate] of tampers) {
    const copy = JSON.parse(JSON.stringify(baseArtifact));
    mutate(copy);
    const verdict = verifyRunArtifact(copy);
    findings.assert(
      id,
      CATEGORY,
      `artifact verification rejects ${label}`,
      P0,
      "Tamper rejection (release gate B)",
      !verdict.ok,
      verdict.ok ? "ACCEPTED a tampered artifact" : `rejected: ${verdict.reasons.join(", ")}`,
    );
  }

  // A rehash after tampering is the strongest attack: the attacker recomputes
  // every downstream hash. Detecting this requires a trusted root, which this
  // repository deliberately does not ship, so the expected outcome is that it
  // is NOT detected — and the docs must say so.
  const rehashed = JSON.parse(JSON.stringify(baseArtifact));
  rehashed.scoreTotal = 4242;
  const { createHash } = await import("node:crypto");
  const { canonicalJson } = await import("../../packages/contracts/dist/index.js");
  const withoutHash = { ...rehashed };
  delete withoutHash.artifactHash;
  rehashed.artifactHash = createHash("sha256").update(canonicalJson(withoutHash)).digest("hex");
  const rehashVerdict = verifyRunArtifact(rehashed);
  findings.assert(
    "A4-25",
    CATEGORY,
    "a fully rehashed artifact is still caught by cross-field consistency",
    P2,
    "hash chain is tamper-evident, not authenticity (documented limitation)",
    !rehashVerdict.ok,
    rehashVerdict.ok
      ? "a rehashed artifact verified clean — this is the documented limit of a chain without a trusted root"
      : `still rejected: ${rehashVerdict.reasons.join(", ")}`,
  );
}

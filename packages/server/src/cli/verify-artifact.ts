import { sha256 } from "@null-city/contracts";
import { blackRiver, goldenScript } from "@null-city/test-fixtures";
import { replayResult, scenarioDigest, verifyRunArtifact, type RunArtifact } from "@null-city/simulation";
import { projectPlayerState } from "@null-city/epistemics";

import { createServer, type NullCityServer } from "../index.js";
import { restClient, driveScriptOverRest, type RestApi } from "../transport.js";

const SEED_A = 49314;
const SEED_B = 100;
const TOTAL_TICKS = 540;

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function fail(name: string, detail: string): CheckResult {
  return { name, pass: false, detail };
}

function ok(name: string, detail: string): CheckResult {
  return { name, pass: true, detail };
}

async function fetchArtifactViaRest(baseUrl: string, sessionId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/artifact`);
  const body = await response.json();
  return { status: response.status, body };
}

async function completeSession(api: RestApi, sessionId: string, seed: number): Promise<void> {
  await api.createSession({ scenarioId: "black-river", seed, sessionId });
  await driveScriptOverRest(api, sessionId, goldenScript());
  await api.advance(sessionId, TOTAL_TICKS);
}

async function main(): Promise<void> {
  const app: NullCityServer = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;
  const api: RestApi = restClient(baseUrl);
  const checks: CheckResult[] = [];

  try {
    // Test A: active session must not receive the artifact early.
    {
      const sessionId = "verify-artifact-active";
      await api.createSession({ scenarioId: "black-river", seed: SEED_A, sessionId });
      const { status, body } = await fetchArtifactViaRest(baseUrl, sessionId);
      const error = (body as { error?: { code: string } }).error;
      if (status === 409 && error?.code === "not_completed") {
        checks.push(ok("A.active-session-denied-artifact", `status=${status} code=${error.code}`));
      } else {
        checks.push(fail("A.active-session-denied-artifact", `status=${status} body=${JSON.stringify(body)}`));
      }
    }

    // Test B: completed session exports a well-formed, independently verifiable artifact.
    let artifactA: RunArtifact | null = null;
    {
      const sessionId = "verify-artifact-completed-a";
      await completeSession(api, sessionId, SEED_A);
      const { status, body } = await fetchArtifactViaRest(baseUrl, sessionId);
      const envelope = body as { ok: boolean; result?: RunArtifact };
      if (status === 200 && envelope.ok && envelope.result) {
        artifactA = envelope.result;
        const verify = verifyRunArtifact(artifactA);
        if (verify.ok) {
          checks.push(
            ok(
              "B.completed-session-artifact-export",
              `hash=${artifactA.artifactHash.slice(0, 16)} events=${artifactA.eventCount} score=${artifactA.scoreTotal}`,
            ),
          );
        } else {
          checks.push(fail("B.completed-session-artifact-export", `verify failed: ${verify.reasons.join("; ")}`));
        }
      } else {
        checks.push(fail("B.completed-session-artifact-export", `status=${status} body=${JSON.stringify(body)}`));
      }
    }

    // Test C: tampering any field of the exported artifact is rejected.
    if (artifactA) {
      const tamperedTruth: RunArtifact = structuredClone(artifactA);
      tamperedTruth.truth.events[5]!.payload = { ...(tamperedTruth.truth.events[5]!.payload as object), tampered: true };
      const truthResult = verifyRunArtifact(tamperedTruth);

      const tamperedScore: RunArtifact = { ...structuredClone(artifactA), scoreTotal: artifactA.scoreTotal + 1234 };
      const scoreResult = verifyRunArtifact(tamperedScore);

      if (!truthResult.ok && !scoreResult.ok) {
        checks.push(ok("C.tamper-rejection", `truth=${truthResult.reasons.join(",")} score=${scoreResult.reasons.join(",")}`));
      } else {
        checks.push(fail("C.tamper-rejection", `truth.ok=${truthResult.ok} score.ok=${scoreResult.ok}`));
      }
    } else {
      checks.push(fail("C.tamper-rejection", "skipped: no artifact from test B"));
    }

    // Test D: rebuilding the player projection from the artifact's player log alone
    // reproduces the same completed phase and score as the artifact's own summary.
    if (artifactA) {
      const projection = projectPlayerState(artifactA.player.events);
      const scoreMatches = projection.score.total === artifactA.scoreTotal;
      const phaseMatches = projection.phase === "completed";
      if (scoreMatches && phaseMatches) {
        checks.push(ok("D.player-projection-rebuild", `score=${projection.score.total} phase=${projection.phase}`));
      } else {
        checks.push(
          fail(
            "D.player-projection-rebuild",
            `score=${projection.score.total} vs ${artifactA.scoreTotal}; phase=${projection.phase}`,
          ),
        );
      }
    } else {
      checks.push(fail("D.player-projection-rebuild", "skipped: no artifact from test B"));
    }

    // Test E: deterministic re-simulation from the embedded truth log's commands
    // reproduces the same terminal event-log hash and state digest (truth
    // rebuild via re-simulation, not just log replay).
    if (artifactA) {
      const scenario = blackRiver();
      const replayed = replayResult(artifactA.truth.events, scenario, artifactA.identity.sessionId, artifactA.identity.seed);
      const sameEventLogHash = replayed.eventLogHash === artifactA.truthLogHash;
      const sameStateDigest = sha256(replayed.finalStateDigest) === artifactA.stateDigest;
      const sameScenarioDigest = scenarioDigest(scenario) === artifactA.identity.scenarioDigest;
      if (sameEventLogHash && sameStateDigest && sameScenarioDigest) {
        checks.push(ok("E.truth-resimulation-equality", `eventLogHash and stateDigest match a from-scratch re-run`));
      } else {
        checks.push(
          fail(
            "E.truth-resimulation-equality",
            `eventLogHash=${sameEventLogHash} stateDigest=${sameStateDigest} scenarioDigest=${sameScenarioDigest}`,
          ),
        );
      }
    } else {
      checks.push(fail("E.truth-resimulation-equality", "skipped: no artifact from test B"));
    }

    // Test F: a second, independently completed session (different seed) also
    // exports a verifiable artifact with the same scenario digest, enabling
    // `run compare` on real data.
    {
      const sessionId = "verify-artifact-completed-b";
      await completeSession(api, sessionId, SEED_B);
      const { status, body } = await fetchArtifactViaRest(baseUrl, sessionId);
      const envelope = body as { ok: boolean; result?: RunArtifact };
      if (status === 200 && envelope.ok && envelope.result) {
        const artifactB = envelope.result;
        const verify = verifyRunArtifact(artifactB);
        const sameScenario = artifactA !== null && artifactB.identity.scenarioDigest === artifactA.identity.scenarioDigest;
        if (verify.ok && sameScenario) {
          checks.push(
            ok(
              "F.second-run-comparable",
              `scoreB=${artifactB.scoreTotal} scenarioDigestMatches=${sameScenario}`,
            ),
          );
        } else {
          checks.push(fail("F.second-run-comparable", `verify.ok=${verify.ok} sameScenario=${sameScenario}`));
        }
      } else {
        checks.push(fail("F.second-run-comparable", `status=${status} body=${JSON.stringify(body)}`));
      }
    }
  } finally {
    await app.close();
  }

  process.stdout.write("=== run artifact / replay lab verification ===\n");
  let allPass = true;
  for (const check of checks) {
    process.stdout.write(`${check.pass ? "PASS" : "FAIL"}  ${check.name}  ${check.detail}\n`);
    if (!check.pass) {
      allPass = false;
    }
  }
  process.exitCode = allPass ? 0 : 1;
}

void main();

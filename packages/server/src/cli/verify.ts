import { SCENARIO_IDS, goldenScriptFor, loadScenario, runScript, type SuiteScenarioId } from "@null-city/test-fixtures";
import { SimulationEngine } from "@null-city/simulation";
import { detectPublicLeak, projectPlayerState } from "@null-city/epistemics";

import { createServer, type NullCityServer } from "../index.js";
import { handleAdminRpc } from "../rpc.js";
import { restClient, driveScriptOverRest, type RestApi } from "../transport.js";

const SEED = 49314;
const RESUME_TICK = 200;

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

function localRun(scenarioId: SuiteScenarioId, sessionId: string): SimulationEngine {
  const engine = new SimulationEngine({ scenario: loadScenario(scenarioId), seed: SEED, sessionId });
  runScript(engine, goldenScriptFor(scenarioId));
  engine.runToEnd();
  return engine;
}

async function main(): Promise<void> {
  const app: NullCityServer = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const api: RestApi = restClient(`http://127.0.0.1:${port}`);
  const checks: CheckResult[] = [];

  try {
    for (const scenarioId of SCENARIO_IDS) {
      const scenario = loadScenario(scenarioId);
      const totalTicks = scenario.totalTicks;

      // Test A: REST golden play matches local score/tick; public payloads stay clean
      {
        const sessionId = `verify-rest-a-${scenarioId}`;
        const reference = localRun(scenarioId, sessionId);
        await api.createSession({ scenarioId, seed: SEED, sessionId });
        await driveScriptOverRest(api, sessionId, goldenScriptFor(scenarioId));
        await api.advance(sessionId, totalTicks);
        const state = await api.state(sessionId);
        const sameScore = (state["score"] as number) === reference.result().score.total;
        const sameTick = (state["tick"] as number) === reference.result().finalTick;
        const leak = detectPublicLeak(state);
        if (sameScore && sameTick && leak === null) {
          checks.push(
            ok(
              `A.rest-determinism[${scenarioId}]`,
              `score=${state["score"]} tick=${state["tick"]} playerHash=${String(state["playerLogHash"]).slice(0, 16)}`,
            ),
          );
        } else {
          checks.push(
            fail(
              `A.rest-determinism[${scenarioId}]`,
              `score=${state["score"]} vs ${reference.result().score.total} tick=${state["tick"]} leak=${leak}`,
            ),
          );
        }
      }

      // Test B: two identical REST-driven sessions produce identical public scores
      {
        const b1Id = `verify-rest-b1-${scenarioId}`;
        const b2Id = `verify-rest-b2-${scenarioId}`;
        await api.createSession({ scenarioId, seed: SEED, sessionId: b1Id });
        await api.createSession({ scenarioId, seed: SEED, sessionId: b2Id });
        await driveScriptOverRest(api, b1Id, goldenScriptFor(scenarioId));
        await driveScriptOverRest(api, b2Id, goldenScriptFor(scenarioId));
        await api.advance(b1Id, totalTicks);
        await api.advance(b2Id, totalTicks);
        const b1 = await api.state(b1Id);
        const b2 = await api.state(b2Id);
        if (b1["score"] === b2["score"] && (b1["tick"] as number) === (b2["tick"] as number)) {
          checks.push(ok(`B.rest-repeatable[${scenarioId}]`, `score=${b1["score"]} tick=${b1["tick"]} identical across sessions`));
        } else {
          checks.push(fail(`B.rest-repeatable[${scenarioId}]`, `b1.score=${b1["score"]} b2.score=${b2["score"]}`));
        }
      }

      // Test C: an admin (in-process) resume, then played out over REST,
      // reproduces the score of an uninterrupted in-process run.
      //
      // Resume is deliberately unreachable from the player transport (audit
      // P0-01), so this drives the authority transfer through `handleAdminRpc`
      // and only the *play* through REST. C2 below asserts the public refusal.
      {
        const sessionId = `verify-rest-resume-${scenarioId}`;
        const reference = new SimulationEngine({ scenario, seed: SEED, sessionId });
        runScript(reference, goldenScriptFor(scenarioId));
        while (reference.currentTick < RESUME_TICK && reference.step()) {
          // advance to the resume point
        }
        const snapshot = reference.snapshot();

        const resumed = handleAdminRpc(app.hub, {
          op: "admin.resume",
          params: { scenarioId, seed: SEED, sessionId, snapshot },
        });
        if (!resumed.ok) {
          checks.push(fail(`C.admin-resume[${scenarioId}]`, `admin.resume rejected: ${resumed.error.message}`));
          continue;
        }
        const tail = goldenScriptFor(scenarioId).filter((c) => c.atTick > RESUME_TICK);
        await driveScriptOverRest(api, sessionId, tail);
        await api.advance(sessionId, totalTicks);

        runScript(reference, tail);
        reference.runToEnd();
        const restored = await api.state(sessionId);
        if ((restored["score"] as number) === reference.result().score.total && (restored["tick"] as number) === totalTicks) {
          checks.push(ok(`C.admin-resume[${scenarioId}]`, `resumeTick=${RESUME_TICK} score=${restored["score"]}`));
        } else {
          checks.push(
            fail(
              `C.admin-resume[${scenarioId}]`,
              `score=${restored["score"]} vs ${reference.result().score.total} tick=${restored["tick"]}`,
            ),
          );
        }

        // C2: the same snapshot must be refused over the player transport.
        const forged = await fetch(`http://127.0.0.1:${port}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId,
            seed: SEED,
            sessionId: `${sessionId}-public`,
            resume: snapshot,
          }),
        });
        const forgedBody = (await forged.json()) as { ok?: boolean; error?: { code?: string } };
        if (forged.status >= 400 && forgedBody.error?.code === "forbidden") {
          checks.push(ok(`C2.public-resume-refused[${scenarioId}]`, `status=${forged.status} code=forbidden`));
        } else {
          checks.push(
            fail(
              `C2.public-resume-refused[${scenarioId}]`,
              `public POST /sessions accepted a caller-supplied snapshot (status=${forged.status})`,
            ),
          );
        }
      }

      // Test D: public state is claim/evidence based — no district truth attributes
      {
        const sessionId = `verify-view-${scenarioId}`;
        await api.createSession({ scenarioId, seed: SEED, sessionId });
        await api.advance(sessionId, 30);
        const after = await api.state(sessionId);
        const view = after["state"] as {
          claims: unknown[];
          evidence: unknown[];
          teams: unknown[];
        };
        const leak = detectPublicLeak(after);
        const hasClaims = Array.isArray(view.claims) && view.claims.length > 0;
        const hasEvidence = Array.isArray(view.evidence) && view.evidence.length > 0;
        if (hasClaims && hasEvidence && leak === null) {
          checks.push(ok(`D.public-claim-model[${scenarioId}]`, `claims=${view.claims.length} evidence=${view.evidence.length}`));
        } else {
          checks.push(
            fail(`D.public-claim-model[${scenarioId}]`, `claims=${view.claims?.length} evidence=${view.evidence?.length} leak=${leak}`),
          );
        }

        // Projection rebuild equals live public state
        const events = await api.events(sessionId, 0);
        const rebuilt = projectPlayerState(events["events"] as never);
        const live = view as never;
        if (JSON.stringify(rebuilt.claims) === JSON.stringify((live as { claims: unknown }).claims)) {
          checks.push(ok(`E.projection-rebuild[${scenarioId}]`, "player events rebuild claims identically"));
        } else {
          checks.push(fail(`E.projection-rebuild[${scenarioId}]`, "claim projection mismatch"));
        }
      }
    }
  } finally {
    await app.close();
  }

  process.stdout.write("=== server verification ===\n");
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

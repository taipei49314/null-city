#!/usr/bin/env node
/**
 * Quickstart example for `@null-city/sdk`.
 *
 * Runs against the **built** `dist/` output of both this package and
 * `@null-city/server` (run `pnpm build` at the repo root first) — nothing
 * here touches TypeScript sources or the simulation/truth internals.
 * It plays a few ticks of Black River using only the public
 * `PlayerSession` interface: create session -> read state -> dispatch a
 * team -> advance -> read state again -> print a summary.
 *
 * Usage (from the repo root, after `pnpm build`):
 *   node packages/sdk/examples/quickstart.mjs
 */
import { createServer } from "@null-city/server";
import { createPlayerSession } from "@null-city/sdk";

async function main() {
  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[quickstart] local NullCity server listening on ${baseUrl}`);

  try {
    const session = await createPlayerSession({
      baseUrl,
      scenarioId: "black-river",
      seed: 49314,
    });
    console.log(`[quickstart] session ${session.sessionId} created (scenario=${session.scenarioId} seed=${session.seed})`);

    const initialState = await session.getState();
    console.log(`[quickstart] tick=${initialState.tick} teams=${initialState.teams.map((t) => t.teamId).join(",")}`);

    const idleTeam = initialState.teams.find((team) => team.status === "idle");
    if (idleTeam) {
      const outcome = await session.submitCommand({
        commandName: "DISPATCH_TEAM",
        params: { teamId: idleTeam.teamId, target: idleTeam.location, task: taskFor(idleTeam.type) },
      });
      console.log(`[quickstart] dispatched ${idleTeam.teamId}: ${outcome.state} (${outcome.result?.detail ?? outcome.validation.errorMessage})`);
    }

    const advanced = await session.advance(30);
    console.log(`[quickstart] advanced to tick=${advanced.tick}, ${advanced.events.length} new player events`);

    const state = await session.getState();
    console.log(`[quickstart] claims=${state.claims.length} evidence=${state.evidence.length} score=${state.score.total}`);

    console.log("[quickstart] PASS — played entirely through @null-city/sdk's public PlayerSession interface");
  } finally {
    await app.close();
  }
}

function taskFor(teamType) {
  return (
    { power: "power_repair", fire: "hazard_control", medical: "medical_support", communications: "comms_repair", verification: "verify" }[
      teamType
    ] ?? "verify"
  );
}

main().catch((error) => {
  console.error(`[quickstart] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

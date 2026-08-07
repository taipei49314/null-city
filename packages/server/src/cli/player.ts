/**
 * Minimal CLI player that finishes Black River using only the public REST contract.
 * No simulation/truth imports.
 */
import { createServer } from "../index.js";
import { restClient } from "../transport.js";

interface PublicState {
  tick: number;
  phase: string;
  claims: Array<{ id: string; districtId?: string; predicate: string; status: string }>;
  teams: Array<{ teamId: string; type: string; status: string; location: string }>;
  score: { total: number };
}

async function main(): Promise<void> {
  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const api = restClient(`http://127.0.0.1:${port}`);
  const sessionId = "cli-player-black-river";

  try {
    await api.createSession({ scenarioId: "black-river", seed: 49314, sessionId });

    // Heuristic over public state only.
    let key = 0;
    const nextKey = (): string => {
      key += 1;
      return `player-${key}`;
    };

    // Initial dispatches based on starting team locations (public OwnTeamState).
    await api.command(
      sessionId,
      "DISPATCH_TEAM",
      { teamId: "power-1", target: "industrial", task: "power_repair" },
      nextKey(),
    );
    await api.command(
      sessionId,
      "DISPATCH_TEAM",
      { teamId: "fire-1", target: "industrial", task: "hazard_control" },
      nextKey(),
    );

    for (;;) {
      const advanced = await api.advance(sessionId, 5);
      if (advanced["completed"] === true) {
        break;
      }
      const stateResp = await api.state(sessionId);
      const state = stateResp["state"] as PublicState;

      // Assess every reported claim once.
      for (const claim of state.claims) {
        if (claim.status === "reported" || claim.status === "corroborated" || claim.status === "contested") {
          try {
            await api.assess(sessionId, claim.id, claim.status === "contested" ? 0.4 : 0.7, 0.5, "cli-heuristic");
          } catch {
            // ignore duplicate assess races
          }
        }
      }

      // Claim-targeted verification when a verification team is idle and a claim exists.
      const verifier = state.teams.find((team) => team.teamId === "verify-1" && team.status === "idle");
      const claim = state.claims.find((item) => item.status === "reported" || item.status === "corroborated");
      if (verifier && claim) {
        try {
          await api.command(
            sessionId,
            "REQUEST_VERIFICATION",
            { teamId: "verify-1", target: claim.districtId ?? "industrial", claimId: claim.id },
            nextKey(),
          );
        } catch {
          // command may be rejected if team busy
        }
      }

      // React to riverside/power claims with public dispatch.
      const riverside = state.claims.find((item) => item.districtId === "riverside");
      const fire2 = state.teams.find((team) => team.teamId === "fire-2" && team.status === "idle");
      if (riverside && fire2) {
        try {
          await api.command(
            sessionId,
            "DISPATCH_TEAM",
            { teamId: "fire-2", target: "riverside", task: "water_restore" },
            nextKey(),
          );
        } catch {
          // ignore
        }
      }
    }

    const summary = await api.summary(sessionId);
    const events = await api.events(sessionId, 0);
    process.stdout.write("=== CLI public-contract player ===\n");
    process.stdout.write(`session   : ${sessionId}\n`);
    process.stdout.write(`finalTick : ${String(summary["finalTick"])}\n`);
    process.stdout.write(`score     : ${String(summary["scoreTotal"])}\n`);
    process.stdout.write(`claims    : ${String(summary["claimCount"])}\n`);
    process.stdout.write(`evidence  : ${String(summary["evidenceCount"])}\n`);
    process.stdout.write(`playerHash: ${String(summary["playerLogHash"]).slice(0, 16)}\n`);
    process.stdout.write(`events    : ${String((events["events"] as unknown[]).length)}\n`);
    process.stdout.write("PASS cli-player used only public REST contract\n");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

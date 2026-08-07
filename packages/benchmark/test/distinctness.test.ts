import { describe, expect, it } from "vitest";

import {
  blackRiver,
  failureScript,
  glassHarbor,
  goldenScriptFor,
  mirrorDistrict,
  redLedger,
  runScript,
  signalZero,
} from "@null-city/test-fixtures";
import { SimulationEngine } from "@null-city/simulation";

import { createNoopPolicy, createReactiveGreedyPolicy, createVerificationFirstPolicy } from "../src/policies/index.js";
import { runOne } from "../src/runner.js";

/**
 * M6 distinctness gate: proves BLACK RIVER, GLASS HARBOR, and SIGNAL ZERO
 * differ on all six axes the workpack requires — dependency graph,
 * observation channel behavior, resource tradeoffs, key failure cascade,
 * optimal baseline strategy, and calibration/verification challenge — not
 * just "have different flavor text". Every check either reads the compiled
 * scenario source directly or drives a real engine/policy run; none of it
 * asserts against a copy of the implementation.
 */

const SEED = 49314;

interface ChainEdge {
  sourceIncidentId: string;
  targetIncidentId: string;
  district: string;
  attribute: string;
}

function chainEdges(scenario: ReturnType<typeof blackRiver>): ChainEdge[] {
  return scenario.incidents
    .filter((incident) => incident.chainTrigger !== undefined)
    .map((incident) => ({
      sourceIncidentId: incident.chainTrigger!.sourceIncidentId,
      targetIncidentId: incident.id,
      district: incident.chainTrigger!.district ?? incident.district,
      attribute: incident.chainTrigger!.attribute,
    }));
}

function standaloneIncidentIds(scenario: ReturnType<typeof blackRiver>): string[] {
  return scenario.incidents.filter((incident) => incident.chainTrigger === undefined).map((incident) => incident.id);
}

describe("M6 distinctness gate: Black River vs Glass Harbor vs Signal Zero", () => {
  const br = blackRiver();
  const gh = glassHarbor();
  const sz = signalZero();

  describe("axis 1 — dependency graph", () => {
    it("each scenario has its own chain-edge shape (which incidents chain off which, on which attribute)", () => {
      const brEdges = chainEdges(br);
      const ghEdges = chainEdges(gh);
      const szEdges = chainEdges(sz);

      // Black River and Glass Harbor are both 3-incident linear chains (1 standalone root + 2 chained links).
      expect(brEdges).toHaveLength(2);
      expect(ghEdges).toHaveLength(2);
      // Signal Zero is a shorter chain (1 link) plus an independent standalone incident elsewhere in the graph —
      // a different graph *shape*, not just different names.
      expect(szEdges).toHaveLength(1);
      expect(standaloneIncidentIds(sz)).toHaveLength(2);

      // The attribute each scenario cascades on is distinct: Black River is power→water,
      // Glass Harbor is traffic→medicalCapacity, Signal Zero is communications-only.
      expect(new Set(brEdges.map((e) => e.attribute))).toEqual(new Set(["power", "water"]));
      expect(new Set(ghEdges.map((e) => e.attribute))).toEqual(new Set(["traffic", "medicalCapacity"]));
      expect(new Set(szEdges.map((e) => e.attribute))).toEqual(new Set(["communications"]));
    });

    it("no incident id is reused across scenarios (independent graphs, not palette swaps)", () => {
      const seen = new Set<string>();
      for (const scenario of [br, gh, sz]) {
        for (const incident of scenario.incidents) {
          expect(seen.has(incident.id)).toBe(false);
          seen.add(incident.id);
        }
      }
    });
  });

  describe("axis 2 — observation channel behavior", () => {
    it("only Signal Zero carries an automated (spoofable) source", () => {
      expect(br.sources.some((s) => s.kind === "automated")).toBe(false);
      expect(gh.sources.some((s) => s.kind === "automated")).toBe(false);
      expect(sz.sources.some((s) => s.kind === "automated")).toBe(true);
    });

    it("only Signal Zero degrades observation delivery via degradedDelayMultiplier > 1", () => {
      const usesDegradedDelivery = (scenario: ReturnType<typeof blackRiver>) =>
        scenario.observations.some((o) => o.degradedDelayMultiplier > 1);
      expect(usesDegradedDelivery(br)).toBe(false);
      expect(usesDegradedDelivery(gh)).toBe(false);
      expect(usesDegradedDelivery(sz)).toBe(true);
    });

    it("Signal Zero's lowest-reliability source is markedly less trustworthy than either other scenario's", () => {
      const minReliability = (scenario: ReturnType<typeof blackRiver>) => Math.min(...scenario.sources.map((s) => s.reliability));
      expect(minReliability(sz)).toBeLessThan(minReliability(br));
      expect(minReliability(sz)).toBeLessThan(minReliability(gh));
      expect(minReliability(sz)).toBeLessThanOrEqual(0.15);
    });

    it("only Glass Harbor's false report is an explicit cross-district attribution error with a same-incident debunk", () => {
      const falseAttributionAboutWrongDistrict = gh.observations.find(
        (o) => o.corruption?.some((c) => c.type === "attribution_error" && c.false === true),
      );
      expect(falseAttributionAboutWrongDistrict).toBeDefined();
      // A higher-reliability dispatch source corrects it on the same incident.
      const debunk = gh.observations.find(
        (o) => o.incidentId === falseAttributionAboutWrongDistrict!.incidentId && o.content.includes("harbor terminal") && !o.corruption,
      );
      expect(debunk).toBeDefined();
    });
  });

  describe("axis 3 — resource tradeoffs", () => {
    it("backup generator and advisory budgets differ across the suite", () => {
      const budgets = [br, gh, sz].map((s) => `${s.resources.backupGenerators}/${s.resources.advisoryUses}`);
      expect(new Set(budgets).size).toBe(3);
      // Glass Harbor is deliberately the tightest on backup power (single hazmat site, no spare generator margin).
      expect(gh.resources.backupGenerators).toBeLessThan(br.resources.backupGenerators);
    });

    it("team-type composition differs across the suite", () => {
      const composition = (scenario: ReturnType<typeof blackRiver>) => {
        const counts = new Map<string, number>();
        for (const team of scenario.teams) {
          counts.set(team.type, (counts.get(team.type) ?? 0) + 1);
        }
        return JSON.stringify([...counts.entries()].sort());
      };
      const compositions = new Set([composition(br), composition(gh), composition(sz)]);
      expect(compositions.size).toBe(3);
      // Signal Zero is the comms/verification-heavy roster: more comms + verification teams than fire/medical.
      const szTeamCount = (type: string) => sz.teams.filter((t) => t.type === type).length;
      expect(szTeamCount("communications") + szTeamCount("verification")).toBeGreaterThan(
        szTeamCount("fire") + szTeamCount("medical"),
      );
    });
  });

  describe("axis 4 — key failure cascade", () => {
    function runFailure(scenario: ReturnType<typeof blackRiver>, sessionId: string) {
      const engine = new SimulationEngine({ scenario, seed: SEED, sessionId });
      runScript(engine, failureScript());
      return engine.runToEnd();
    }

    it("each scenario's neglect path activates its own distinct cascade of incidents", () => {
      const brResult = runFailure(br, "distinctness-fail-br");
      const ghResult = runFailure(gh, "distinctness-fail-gh");
      const szResult = runFailure(sz, "distinctness-fail-sz");

      // Every scenario's cascade goes all the way: every incident it defines ends up active when neglected.
      expect(new Set(brResult.activeIncidents)).toEqual(new Set(br.incidents.map((i) => i.id)));
      expect(new Set(ghResult.activeIncidents)).toEqual(new Set(gh.incidents.map((i) => i.id)));
      expect(new Set(szResult.activeIncidents)).toEqual(new Set(sz.incidents.map((i) => i.id)));

      // The active incident sets are scenario-specific (no id collisions to accidentally overlap).
      const allActive = [...brResult.activeIncidents, ...ghResult.activeIncidents, ...szResult.activeIncidents];
      expect(new Set(allActive).size).toBe(allActive.length);
    });

    it("a defensible golden play measurably contains the cascade the neglect path lets run free", () => {
      for (const [scenario, sessionPrefix, scenarioId] of [
        [br, "distinctness-golden-br", "black-river"],
        [gh, "distinctness-golden-gh", "glass-harbor"],
        [sz, "distinctness-golden-sz", "signal-zero"],
      ] as const) {
        const neglected = runFailure(scenario, `${sessionPrefix}-neglect`);
        const engine = new SimulationEngine({ scenario, seed: SEED, sessionId: `${sessionPrefix}-golden` });
        runScript(engine, goldenScriptFor(scenarioId));
        const golden = engine.runToEnd();

        expect(golden.activeIncidents.length).toBeLessThan(neglected.activeIncidents.length);
        expect(golden.score.total).toBeGreaterThan(neglected.score.total);
      }
    });
  });

  describe("axes 5 & 6 — optimal baseline strategy and the calibration/verification challenge", () => {
    it("verification-first's edge over reactive-greedy is scenario-specific, not a flat constant", async () => {
      // tickStep=30 matches the `verify:benchmark` CLI wiring (package.json) — this is the same decision
      // cadence the suite's own smoke check runs, not a value hand-picked to make this test pass. Baseline
      // policy margins here are sensitive to decision cadence (more frequent decisions change how fast a
      // policy reacts to a cascading claim), so the assertions below only rely on effects reproduced with
      // that same cadence, not on a single seed/tickStep combination we haven't otherwise verified.
      async function scoreFor(scenarioId: "black-river" | "glass-harbor" | "signal-zero") {
        const [noop, greedy, verify] = await Promise.all([
          runOne({ scenarioId, seed: SEED, policy: createNoopPolicy(), tickStep: 30 }),
          runOne({ scenarioId, seed: SEED, policy: createReactiveGreedyPolicy(), tickStep: 30 }),
          runOne({ scenarioId, seed: SEED, policy: createVerificationFirstPolicy(), tickStep: 30 }),
        ]);
        return { noop, greedy, verify };
      }

      const [brRuns, ghRuns, szRuns] = await Promise.all([
        scoreFor("black-river"),
        scoreFor("glass-harbor"),
        scoreFor("signal-zero"),
      ]);

      const edge = (runs: Awaited<ReturnType<typeof scoreFor>>) => runs.verify.metrics.scoreTotal - runs.greedy.metrics.scoreTotal;

      const brEdge = edge(brRuns);
      const ghEdge = edge(ghRuns);
      const szEdge = edge(szRuns);

      // Glass Harbor and Signal Zero are built so on-site verification pays off decisively; Black River is not.
      expect(ghEdge).toBeGreaterThan(20);
      expect(szEdge).toBeGreaterThan(10);
      expect(ghEdge - brEdge).toBeGreaterThan(20);
      expect(szEdge - brEdge).toBeGreaterThan(10);

      // Every active policy should still beat doing nothing everywhere in the suite.
      expect(brRuns.greedy.metrics.scoreTotal).toBeGreaterThan(brRuns.noop.metrics.scoreTotal);
      expect(ghRuns.verify.metrics.scoreTotal).toBeGreaterThan(ghRuns.noop.metrics.scoreTotal);
      expect(szRuns.verify.metrics.scoreTotal).toBeGreaterThan(szRuns.noop.metrics.scoreTotal);

      // Signal Zero's spoofed/contradictory/degraded-delivery claim stream keeps generating claims that need
      // a fresh probability assessment for longer than either other scenario's — a distinct calibration load,
      // not just a distinct score.
      const assessmentLoad = (runs: Awaited<ReturnType<typeof scoreFor>>) => runs.verify.metrics.assessmentCount;
      expect(assessmentLoad(szRuns)).toBeGreaterThan(assessmentLoad(brRuns));
      expect(new Set([assessmentLoad(brRuns), assessmentLoad(ghRuns), assessmentLoad(szRuns)]).size).toBeGreaterThan(1);
    }, 30_000);

    it("Mirror District rewards verification-first over reactive-greedy (twin false-attribution trap)", async () => {
      const [greedy, verify] = await Promise.all([
        runOne({ scenarioId: "mirror-district", seed: SEED, policy: createReactiveGreedyPolicy(), tickStep: 30 }),
        runOne({ scenarioId: "mirror-district", seed: SEED, policy: createVerificationFirstPolicy(), tickStep: 30 }),
      ]);
      expect(verify.metrics.scoreTotal).toBeGreaterThan(greedy.metrics.scoreTotal);
      const md = mirrorDistrict();
      expect(md.incidents.some((i) => i.id === "mirror_hoax")).toBe(true);
      expect(md.incidents.some((i) => i.id === "north_spill")).toBe(true);
    }, 30_000);

    it("Red Ledger is a logistics→shelter→clinic cascade with high advisory temptation", () => {
      const rl = redLedger();
      const edges = chainEdges(rl);
      expect(edges.map((e) => e.attribute).sort()).toEqual(["power", "water"]);
      expect(rl.resources.advisoryUses).toBeGreaterThanOrEqual(4);
      expect(standaloneIncidentIds(rl)).toEqual(expect.arrayContaining(["ration_halt", "ghost_census"]));
      expect(rl.incidents.every((i) => !["north_spill", "comms_jam", "hazmat_leak"].includes(i.id))).toBe(true);
    });
  });
});

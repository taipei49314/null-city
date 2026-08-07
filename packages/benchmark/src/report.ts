import type { RunRecord } from "./runner.js";

export interface JsonReport {
  format: "nullcity-benchmark-report";
  version: 1;
  generatedAt: string;
  runCount: number;
  runs: RunRecord[];
}

/**
 * The JSON report is the "run artifact" this package promises: every
 * metric in it is recomputable by re-running `computeMetrics` over the
 * `playerLogHash`-verified event log that produced it (the runner already
 * verifies before recording — see `runner.ts`).
 */
export function buildJsonReport(runs: RunRecord[]): JsonReport {
  return {
    format: "nullcity-benchmark-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    runs,
  };
}

function fmt(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

/**
 * Builds a human-readable comparison across scenarios/seeds/policies. Every
 * cell traces back to a field in the corresponding `RunRecord`/`BenchmarkMetrics`.
 */
export function buildMarkdownReport(runs: RunRecord[]): string {
  const lines: string[] = [];
  lines.push("# NullCity Benchmark Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Runs: ${runs.length}`);
  lines.push("");
  lines.push(
    "All metrics are computed from each run's hash-chain-verified public player event log only. " +
      "No policy or metric in this report ever received truth.",
  );
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Scenario | Seed | Policy | Verified | Final Tick | Score | Invalid Cmd Rate | Cascades | Wasted Dispatch | False Advisory | Brier | Info Gain |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const run of runs) {
    lines.push(
      `| ${run.scenarioId} | ${run.seed} | ${run.policyId} | ${run.playerLogVerified ? "yes" : "NO"} | ${run.finalTick} | ${fmt(run.metrics.scoreTotal)} | ${fmt(run.metrics.invalidCommandRate, 3)} | ${run.metrics.cascadeCount} | ${fmt(run.metrics.wastedDispatchPenalty)} | ${fmt(run.metrics.falseAdvisoryCost)} | ${fmt(run.metrics.brierScore, 3)} | ${fmt(run.metrics.verificationInfoGain, 3)} |`,
    );
  }
  lines.push("");

  lines.push("## Best policy per scenario/seed (by final score)");
  lines.push("");
  const byScenarioSeed = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const key = `${run.scenarioId}::${run.seed}`;
    const list = byScenarioSeed.get(key) ?? [];
    list.push(run);
    byScenarioSeed.set(key, list);
  }
  lines.push("| Scenario | Seed | Best Policy | Score |");
  lines.push("|---|---|---|---|");
  for (const [key, list] of byScenarioSeed) {
    const [scenarioId, seed] = key.split("::");
    const best = list.reduce((a, b) => (a.metrics.scoreTotal >= b.metrics.scoreTotal ? a : b));
    lines.push(`| ${scenarioId} | ${seed} | ${best.policyId} | ${fmt(best.metrics.scoreTotal)} |`);
  }
  lines.push("");

  lines.push("## Per-run detail");
  lines.push("");
  for (const run of runs) {
    lines.push(`### ${run.scenarioId} / seed ${run.seed} / ${run.policyId}`);
    lines.push("");
    lines.push(`- Session: \`${run.sessionId}\``);
    lines.push(`- Player log: \`${run.playerLogHash}\` (${run.playerEventCount} events, chain valid: ${run.playerLogVerified})`);
    lines.push(`- Phase: ${run.phase}, final tick: ${run.finalTick}`);
    lines.push(`- Score total: ${fmt(run.metrics.scoreTotal)}`);
    lines.push(
      `  - population risk contribution: ${fmt(run.metrics.populationRiskScoreContribution)}, infrastructure contribution: ${fmt(run.metrics.infrastructureScoreContribution)}`,
    );
    lines.push(
      `  - events handled: ${fmt(run.metrics.eventsHandledScoreContribution)}, events missed: ${fmt(run.metrics.eventsMissedScoreContribution)}`,
    );
    lines.push(
      `  - cascade count: ${run.metrics.cascadeCount} (penalty ${fmt(run.metrics.cascadePenalty)}), wasted dispatch: ${fmt(run.metrics.wastedDispatchPenalty)}, false advisory cost: ${fmt(run.metrics.falseAdvisoryCost)}, decision delay: ${fmt(run.metrics.decisionDelayPenalty)}, resource efficiency: ${fmt(run.metrics.resourceEfficiencyScore)}`,
    );
    lines.push(
      `- Commands: ${run.metrics.totalCommandsSubmitted} submitted, invalid rate ${fmt(run.metrics.invalidCommandRate, 3)} (${run.metrics.commandsByName.map((c) => `${c.commandName}: ${c.accepted}✓/${c.rejected}✗`).join(", ") || "none"})`,
    );
    lines.push(
      `- Response latency: mean ${fmt(run.metrics.meanResponseLatencyTicks, 1)} ticks over ${run.metrics.responseLatencies.filter((r) => r.latencyTicks !== null).length}/${run.metrics.responseLatencies.length} claims`,
    );
    lines.push(
      `- Assessments: ${run.metrics.assessmentCount}, resolved claims ${run.metrics.resolvedClaimCount} (${run.metrics.verifiedClaimCount} verified / ${run.metrics.refutedClaimCount} refuted), Brier score ${fmt(run.metrics.brierScore, 3)}, verification info gain ${fmt(run.metrics.verificationInfoGain, 3)}`,
    );
    if (run.errors.length > 0) {
      lines.push(`- Errors (${run.errors.length}): ${run.errors.map((e) => `[${e.phase}@${e.tick}] ${e.message}`).join("; ")}`);
    }
    if (run.boundedOutputTruncations > 0 || run.decisionTimeouts > 0) {
      lines.push(
        `- Bounded-output truncations: ${run.boundedOutputTruncations}, decision timeouts: ${run.decisionTimeouts}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

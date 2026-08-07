#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_POLICY_IDS, DEFAULT_SCENARIO_IDS, DEFAULT_SEEDS, runMatrix } from "./matrix.js";
import { buildJsonReport, buildMarkdownReport } from "./report.js";
import { BASELINE_POLICY_IDS, type BaselinePolicyId } from "./policies/index.js";

interface Args {
  scenarioIds: string[];
  seeds: number[];
  policyIds: BaselinePolicyId[];
  outDir: string;
  tickStep?: number;
  decisionTimeoutMs?: number;
  runTimeoutMs?: number;
}

function parseArgs(argv: string[]): Args {
  const scenarioIds: string[] = [];
  const seeds: number[] = [];
  const policyIds: BaselinePolicyId[] = [];
  let outDir = "data/benchmark";
  let tickStep: number | undefined;
  let decisionTimeoutMs: number | undefined;
  let runTimeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case "--scenario":
        scenarioIds.push(next());
        break;
      case "--seed":
        seeds.push(Number(next()));
        break;
      case "--policy": {
        const value = next();
        if (value === "all") {
          policyIds.push(...BASELINE_POLICY_IDS);
          break;
        }
        if (!BASELINE_POLICY_IDS.includes(value as BaselinePolicyId)) {
          throw new Error(`unknown policy ${JSON.stringify(value)}; expected one of ${BASELINE_POLICY_IDS.join(", ")} or "all"`);
        }
        policyIds.push(value as BaselinePolicyId);
        break;
      }
      case "--out":
        outDir = next();
        break;
      case "--tick-step":
        tickStep = Number(next());
        break;
      case "--decision-timeout-ms":
        decisionTimeoutMs = Number(next());
        break;
      case "--run-timeout-ms":
        runTimeoutMs = Number(next());
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }

  return {
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : DEFAULT_SCENARIO_IDS,
    seeds: seeds.length > 0 ? seeds : DEFAULT_SEEDS,
    policyIds: policyIds.length > 0 ? policyIds : DEFAULT_POLICY_IDS,
    outDir,
    tickStep,
    decisionTimeoutMs,
    runTimeoutMs,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(
    `[bench] running ${args.scenarioIds.length} scenario(s) x ${args.seeds.length} seed(s) x ${args.policyIds.length} policy(ies) = ${
      args.scenarioIds.length * args.seeds.length * args.policyIds.length
    } run(s)\n`,
  );
  process.stdout.write(`[bench] scenarios=${args.scenarioIds.join(",")} seeds=${args.seeds.join(",")} policies=${args.policyIds.join(",")}\n`);

  const records = await runMatrix({
    scenarioIds: args.scenarioIds,
    seeds: args.seeds,
    policyIds: args.policyIds,
    tickStep: args.tickStep,
    decisionTimeoutMs: args.decisionTimeoutMs,
    runTimeoutMs: args.runTimeoutMs,
    onRunComplete: (record) => {
      process.stdout.write(
        `[bench] ${record.scenarioId} seed=${record.seed} policy=${record.policyId} verified=${record.playerLogVerified} score=${record.metrics.scoreTotal} tick=${record.finalTick} errors=${record.errors.length}\n`,
      );
    },
  });

  mkdirSync(args.outDir, { recursive: true });
  const jsonPath = join(args.outDir, "report.json");
  const mdPath = join(args.outDir, "report.md");
  writeFileSync(jsonPath, JSON.stringify(buildJsonReport(records), null, 2));
  writeFileSync(mdPath, buildMarkdownReport(records));
  process.stdout.write(`[bench] wrote ${jsonPath} and ${mdPath}\n`);

  const allVerified = records.every((r) => r.playerLogVerified);
  const noHardErrors = records.every((r) => r.errors.every((e) => e.phase !== "advance"));
  if (!allVerified) {
    process.stderr.write("[bench] FAIL: at least one run's player event log failed hash-chain verification\n");
    process.exitCode = 1;
    return;
  }
  if (!noHardErrors) {
    process.stderr.write("[bench] FAIL: at least one run hit an unrecovered advance error\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("[bench] PASS\n");
}

main().catch((error) => {
  process.stderr.write(`[bench] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

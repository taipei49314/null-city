import { createBaselinePolicy, type BaselinePolicyId } from "./policies/index.js";
import { runOne, type RunOptions, type RunRecord } from "./runner.js";

export interface MatrixOptions {
  scenarioIds: string[];
  seeds: number[];
  policyIds: BaselinePolicyId[];
  tickStep?: number;
  decisionTimeoutMs?: number;
  runTimeoutMs?: number;
  /** Called after each individual run completes, for progress reporting. */
  onRunComplete?: (record: RunRecord) => void;
}

export const DEFAULT_SCENARIO_IDS = [
  "black-river",
  "glass-harbor",
  "signal-zero",
  "mirror-district",
  "red-ledger",
];
export const DEFAULT_SEEDS = [49314, 100];
export const DEFAULT_POLICY_IDS: BaselinePolicyId[] = ["noop", "reactive-greedy", "verification-first"];

/**
 * Runs every (scenario, seed, policy) combination sequentially (each spins
 * its own ephemeral in-process server, so parallelizing would only add
 * complexity, not real speedup on a single machine) and returns every
 * `RunRecord`. No API key is required — every policy here is a
 * deterministic, local, non-LLM baseline.
 */
export async function runMatrix(options: MatrixOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const scenarioId of options.scenarioIds) {
    for (const seed of options.seeds) {
      for (const policyId of options.policyIds) {
        const runOptions: RunOptions = {
          scenarioId,
          seed,
          policy: createBaselinePolicy(policyId),
          tickStep: options.tickStep,
          decisionTimeoutMs: options.decisionTimeoutMs,
          runTimeoutMs: options.runTimeoutMs,
        };
        const record = await runOne(runOptions);
        records.push(record);
        options.onRunComplete?.(record);
      }
    }
  }
  return records;
}

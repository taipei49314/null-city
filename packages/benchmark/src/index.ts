export type { Policy, PolicyContext, PolicyDecision, PolicyInput } from "./policy.js";
export { emptyDecision } from "./policy.js";

export {
  createBaselinePolicy,
  createNoopPolicy,
  createReactiveGreedyPolicy,
  createVerificationFirstPolicy,
  BASELINE_POLICY_IDS,
} from "./policies/index.js";
export type { BaselinePolicyId } from "./policies/index.js";

export { computeMetrics } from "./metrics.js";
export type { BenchmarkMetrics, CalibrationBin, CommandStat, ResponseLatency } from "./metrics.js";

export { runOne, MAX_COMMANDS_PER_DECISION, MAX_ASSESSMENTS_PER_DECISION } from "./runner.js";
export type { RunOptions, RunRecord, RecordedCommand, RecordedAssessment, RecordedError } from "./runner.js";

export { runMatrix, DEFAULT_SCENARIO_IDS, DEFAULT_SEEDS, DEFAULT_POLICY_IDS } from "./matrix.js";
export type { MatrixOptions } from "./matrix.js";

export { buildJsonReport, buildMarkdownReport } from "./report.js";
export type { JsonReport } from "./report.js";

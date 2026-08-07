# @null-city/benchmark

A local scenario/seed benchmark runner that plays NullCity with
deterministic, non-LLM policies through `@null-city/sdk`'s
`PlayerSession` — the same public interface the Command Center browser
app and the MCP adapter use. No policy or metric here ever receives
truth; every number in a report is computed from the run's own
hash-chain-verified public player event log, so any third party holding
the same event log can independently recompute every metric.

## What this package is (and is not)

- It **is** a matrix runner over `(scenarioId, seed, policyId)` that
  spins up a real, ephemeral `@null-city/server`, plays it end to end via
  `@null-city/sdk`, and records everything (commands, assessments,
  errors, metadata) plus derived metrics.
- It **is not** an LLM harness. The three shipped policies
  (`noop`, `reactive-greedy`, `verification-first`) are pure functions of
  `PlayerSessionState`, run in-process, and require no API key. The
  default suite (`pnpm bench`, `pnpm verify:benchmark`) never calls out
  to a model provider.
- It has **no** access to truth. `test/forbidden-imports.test.ts` allows
  only `createServer`/`NullCityServer` from `@null-city/server` (needed
  to own the ephemeral process each run listens on) and forbids
  `@null-city/simulation`, `@null-city/epistemics`, and any truth-only
  `@null-city/contracts` symbol from `src/`.

## Install / build

This is a private workspace package. From the repo root:

```bash
pnpm install
pnpm build   # builds this package and its workspace dependencies
```

## Running the benchmark

```bash
# Full default matrix (all built-in scenarios x seeds x policies):
pnpm bench

# A specific slice:
node packages/benchmark/dist/cli.js --scenario black-river --seed 49314 --policy reactive-greedy --out data/benchmark
node packages/benchmark/dist/cli.js --policy all --scenario black-river --seed 49314 --seed 100
```

| Flag | Repeatable | Meaning |
| --- | --- | --- |
| `--scenario <id>` | yes | Scenario id. Defaults to `DEFAULT_SCENARIO_IDS` (`src/matrix.ts`). |
| `--seed <n>` | yes | Deterministic seed. Defaults to `DEFAULT_SEEDS`. |
| `--policy <id\|all>` | yes | `noop`, `reactive-greedy`, `verification-first`, or `all`. Defaults to `DEFAULT_POLICY_IDS`. |
| `--out <dir>` | no | Output directory for `report.json`/`report.md`. Default `data/benchmark`. |
| `--tick-step <n>` | no | Ticks advanced per decision loop (default 5). |
| `--decision-timeout-ms <n>` | no | Wall-clock budget per `policy.decide()` call (default 250ms) — a slow/hung policy is skipped for that tick, not fatal to the run. |
| `--run-timeout-ms <n>` | no | Wall-clock safety net for the whole run (default 60000ms). |

The CLI exits non-zero (`[bench] FAIL`) if any run's player event log
fails hash-chain verification, or hits an unrecovered `advance` error —
a benchmark result is only ever reported for a run that's provably
intact.

`pnpm verify:benchmark` runs a fast, fixed smoke slice
(`black-river`/`49314`, `noop` + `reactive-greedy`, `--tick-step 30`) as
one of the `pnpm verify` gates, so a broken runner/policy/metric fails
CI without requiring the full matrix or any API key.

## Policies (`src/policies/`)

All three are deterministic given the same `PlayerSessionState` sequence
— no randomness, no memory of truth, no wall-clock dependence:

- **`noop`** — never issues a command or an assessment. The
  neglect/failure baseline every other policy should beat.
- **`reactive-greedy`** — dispatches every idle, non-verification team to
  the oldest unresolved claim in a district no other team is already
  being sent to that tick. No claim-belief tracking.
- **`verification-first`** — prioritizes sending idle verification teams
  at the oldest contested-then-reported claim; submits exactly one
  probability assessment per claim the first time it's observed (a
  deterministic prior keyed off `claim.status`, see
  `verificationFirst.ts#priorProbability`); falls back to the same greedy
  dispatch as `reactive-greedy` for remaining idle work teams.

Each run is bounded (`MAX_COMMANDS_PER_DECISION` /
`MAX_ASSESSMENTS_PER_DECISION` = 10 per decision tick in `runner.ts`) so
a runaway or misbehaving policy can never flood the transport; a
truncation is recorded on the run (`boundedOutputTruncations`), not
silently dropped.

## Metrics (`src/metrics.ts`)

`computeMetrics(events)` is a pure function of the verified public
player event stream — nothing else. Every field maps to a workpack
metric:

| Workpack metric | Field(s) | Derivation |
| --- | --- | --- |
| Final operational outcome | `scoreTotal`, `finalTick`, `phase` | Last `PublicScoreChanged.total`; last event's `tick`; `RunCompleted` seen. |
| Population risk / infrastructure availability | `populationRiskScoreContribution`, `infrastructureScoreContribution` | Sum of `PublicScoreChanged.delta` where `category` is `population_risk` / `infrastructure`. |
| Response stage latencies | `responseLatencies`, `meanResponseLatencyTicks` | Per claim: ticks between `ClaimUpdated.firstObservedTick` and the first `CommandResult(accepted)` targeting that claim's district at or after that tick. |
| Invalid command rate | `invalidCommandCount`, `invalidCommandRate`, `commandsByName` | Fraction of `CommandResult` events with `state: "rejected"`. |
| Resource efficiency / wasted dispatch | `resourceEfficiencyScore`, `wastedDispatchPenalty` | Sum of `PublicScoreChanged.delta` for categories `resource_efficiency` / `wasted_dispatch` — these are the exact `id`s `packages/simulation/src/score.ts#computeScore` emits, echoed verbatim onto the public stream. |
| False advisory cost | `falseAdvisoryCost` | Sum of `PublicScoreChanged.delta` for category `misadvisory`. |
| Cascade count / penalty | `cascadeCount`, `cascadePenalty` | Count and delta-sum of `PublicScoreChanged` events with category `chain_failure`. |
| Assessment Brier score / calibration bins | `brierScore`, `calibrationBins` | Mean squared error of each resolved claim's latest pre-resolution probability vs. its `verified`/`refuted` outcome (1/0); 10 probability-decile bins with `meanPredicted` vs. `empiricalFrequency`. |
| Verification information gain | `verificationInfoGain` | Mean (squared-error before `VerificationResolved` minus squared-error after) across claims with assessments on both sides of their resolution; positive = verification made beliefs measurably more accurate. |

Because every score category (`population_risk`, `infrastructure`,
`events_handled`, `events_missed`, `chain_failure`, `wasted_dispatch`,
`misadvisory`, `decision_delay`, `resource_efficiency`) is echoed
verbatim onto the public stream by `packages/epistemics/src/bridge.ts`,
summing a category's deltas reproduces its exact contribution to the
final score — **without ever needing the truth-side raw values**.

## Reports (`src/report.ts`)

Every run writes `report.json` (`{ format: "nullcity-benchmark-report", version: 1, runs: RunRecord[] }`,
one `RunRecord` per `(scenario, seed, policy)` with the full command/
assessment/error log, `playerLogHash`, `playerLogVerified`, and
`metrics`) and `report.md` (a human-readable summary table, best-policy-
per-scenario/seed table, and full per-run detail) to `--out`.
Every cell in the Markdown report traces back to a `RunRecord`/
`BenchmarkMetrics` field — nothing is computed only for display.

## What's covered by tests

- `test/policies.test.ts` — each policy's decisions given hand-built
  `PlayerSessionState` fixtures (idle teams, unresolved claims,
  already-targeted districts, etc.).
- `test/metrics.test.ts` — `computeMetrics` against hand-built event
  sequences: score-category summation, invalid-rate computation, Brier
  score and calibration binning, verification info gain sign.
- `test/runner.test.ts` — end-to-end integration: a full run over a real
  loopback server completes, verifies, and produces bounded metrics; the
  same scenario/seed/policy is deterministic across two runs; `noop`
  never issues a command and never outscores an active policy; a
  throwing policy still finishes (decisions are swallowed as recorded
  errors, not fatal); a spammy policy's output is truncated and counted.
- `test/forbidden-imports.test.ts` — `src/` never imports
  `@null-city/simulation` or `@null-city/epistemics`, never references a
  truth-only `@null-city/contracts` symbol, and only imports
  `createServer`/`NullCityServer` from `@null-city/server`.

Run them with:

```bash
pnpm build   # from repo root; workspace packages resolve via dist
pnpm --filter @null-city/benchmark test
```

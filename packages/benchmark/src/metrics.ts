import type { PlayerEventEnvelope } from "@null-city/contracts";

/**
 * Every metric below is a pure function of the **public player event
 * stream** (`PlayerEventEnvelope[]`, verified via
 * `verifyPlayerEventStream` before this module ever sees it — see
 * `runner.ts`). None of it touches truth. That means every number here is
 * independently recomputable by any third party who has the same
 * player-event-log artifact this package writes to disk, without ever
 * needing server access or truth.
 *
 * Score-breakdown categories (`population_risk`, `infrastructure`,
 * `events_handled`, `events_missed`, `chain_failure`, `wasted_dispatch`,
 * `misadvisory`, `decision_delay`, `resource_efficiency`) are exactly the
 * `id`s `packages/simulation/src/score.ts#computeScore` emits, and are
 * echoed verbatim onto the public stream as `PublicScoreChanged.category`
 * by `packages/epistemics/src/bridge.ts`. Summing a category's deltas
 * across the whole run reproduces that category's exact contribution to
 * the final score — this module never needs the truth-side raw
 * percentages themselves, only their public score effect.
 */

export interface CommandStat {
  commandName: string;
  accepted: number;
  rejected: number;
}

interface CategoryTotal {
  total: number;
  count: number;
}

export interface ResponseLatency {
  claimId: string;
  districtId: string | undefined;
  firstObservedTick: number;
  firstActionTick: number | null;
  latencyTicks: number | null;
}

export interface CalibrationBin {
  rangeStart: number;
  rangeEnd: number;
  count: number;
  meanPredicted: number;
  empiricalFrequency: number;
}

export interface BenchmarkMetrics {
  finalTick: number;
  phase: "running" | "completed";
  scoreTotal: number;

  populationRiskScoreContribution: number;
  infrastructureScoreContribution: number;
  eventsHandledScoreContribution: number;
  eventsMissedScoreContribution: number;
  cascadeCount: number;
  cascadePenalty: number;
  wastedDispatchPenalty: number;
  falseAdvisoryCost: number;
  decisionDelayPenalty: number;
  resourceEfficiencyScore: number;

  totalCommandsSubmitted: number;
  invalidCommandCount: number;
  invalidCommandRate: number;
  commandsByName: CommandStat[];

  responseLatencies: ResponseLatency[];
  meanResponseLatencyTicks: number | null;

  assessmentCount: number;
  resolvedClaimCount: number;
  verifiedClaimCount: number;
  refutedClaimCount: number;
  brierScore: number | null;
  calibrationBins: CalibrationBin[];
  /**
   * Mean squared-error improvement (before minus after) for claims that
   * had at least one assessment before AND after their verification
   * resolved. Positive = verification made beliefs measurably more
   * accurate on average. `null` when no claim has both pre- and
   * post-verification assessments.
   */
  verificationInfoGain: number | null;
}

interface ClaimTrack {
  districtId?: string;
  firstObservedTick: number;
  latestStatus: string;
}

interface AssessmentRecord {
  probability: number;
  submittedTick: number;
}

const CATEGORY_KEYS = [
  "population_risk",
  "infrastructure",
  "events_handled",
  "events_missed",
  "chain_failure",
  "wasted_dispatch",
  "misadvisory",
  "decision_delay",
  "resource_efficiency",
] as const;

function outcomeLabel(status: string): 0 | 1 | null {
  if (status === "verified") {
    return 1;
  }
  if (status === "refuted") {
    return 0;
  }
  return null;
}

export function computeMetrics(events: readonly PlayerEventEnvelope[]): BenchmarkMetrics {
  const categoryTotals = new Map<string, CategoryTotal>();
  for (const key of CATEGORY_KEYS) {
    categoryTotals.set(key, { total: 0, count: 0 });
  }

  const commandStats = new Map<string, CommandStat>();
  const claims = new Map<string, ClaimTrack>();
  const acceptedCommandsByTargetTick: Array<{ target: string; tick: number }> = [];
  const assessmentsByClaim = new Map<string, AssessmentRecord[]>();
  const verificationResolvedTickByClaim = new Map<string, number>();

  let scoreTotal = 0;
  let finalTick = 0;
  let phase: "running" | "completed" = "running";
  let totalCommandsSubmitted = 0;
  let invalidCommandCount = 0;

  for (const event of events) {
    finalTick = Math.max(finalTick, event.tick);

    switch (event.kind) {
      case "PublicScoreChanged": {
        const payload = event.payload as { delta: number; category: string; total: number };
        scoreTotal = payload.total;
        const bucket = categoryTotals.get(payload.category) ?? { total: 0, count: 0 };
        bucket.total += payload.delta;
        bucket.count += 1;
        categoryTotals.set(payload.category, bucket);
        break;
      }
      case "CommandResult": {
        const payload = event.payload as { commandName: string; state: "accepted" | "rejected"; target: string };
        totalCommandsSubmitted += 1;
        const stat = commandStats.get(payload.commandName) ?? { commandName: payload.commandName, accepted: 0, rejected: 0 };
        if (payload.state === "accepted") {
          stat.accepted += 1;
          if (payload.target) {
            acceptedCommandsByTargetTick.push({ target: payload.target, tick: event.tick });
          }
        } else {
          stat.rejected += 1;
          invalidCommandCount += 1;
        }
        commandStats.set(payload.commandName, stat);
        break;
      }
      case "ClaimUpdated": {
        const payload = event.payload as {
          claim: { id: string; districtId?: string; firstObservedTick: number; status: string };
        };
        const existing = claims.get(payload.claim.id);
        claims.set(payload.claim.id, {
          districtId: payload.claim.districtId ?? existing?.districtId,
          firstObservedTick: existing?.firstObservedTick ?? payload.claim.firstObservedTick,
          latestStatus: payload.claim.status,
        });
        break;
      }
      case "AssessmentSubmitted": {
        const payload = event.payload as { assessment: { claimId: string; probability: number; submittedTick: number } };
        const list = assessmentsByClaim.get(payload.assessment.claimId) ?? [];
        list.push({ probability: payload.assessment.probability, submittedTick: payload.assessment.submittedTick });
        assessmentsByClaim.set(payload.assessment.claimId, list);
        break;
      }
      case "VerificationResolved": {
        const payload = event.payload as { claimId: string; resolvedTick: number };
        verificationResolvedTickByClaim.set(payload.claimId, payload.resolvedTick);
        break;
      }
      case "RunCompleted": {
        phase = "completed";
        break;
      }
      default:
        break;
    }
  }

  const responseLatencies: ResponseLatency[] = [];
  for (const [claimId, claim] of claims) {
    let firstActionTick: number | null = null;
    if (claim.districtId) {
      for (const command of acceptedCommandsByTargetTick) {
        if (command.target === claim.districtId && command.tick >= claim.firstObservedTick) {
          if (firstActionTick === null || command.tick < firstActionTick) {
            firstActionTick = command.tick;
          }
        }
      }
    }
    responseLatencies.push({
      claimId,
      districtId: claim.districtId,
      firstObservedTick: claim.firstObservedTick,
      firstActionTick,
      latencyTicks: firstActionTick === null ? null : firstActionTick - claim.firstObservedTick,
    });
  }
  const knownLatencies = responseLatencies.map((r) => r.latencyTicks).filter((v): v is number => v !== null);
  const meanResponseLatencyTicks = knownLatencies.length === 0 ? null : mean(knownLatencies);

  let assessmentCount = 0;
  for (const list of assessmentsByClaim.values()) {
    assessmentCount += list.length;
  }

  const resolvedPairs: Array<{ probability: number; outcome: 0 | 1 }> = [];
  let verifiedClaimCount = 0;
  let refutedClaimCount = 0;
  for (const [claimId, claim] of claims) {
    const outcome = outcomeLabel(claim.latestStatus);
    if (outcome === null) {
      continue;
    }
    if (outcome === 1) {
      verifiedClaimCount += 1;
    } else {
      refutedClaimCount += 1;
    }
    const list = assessmentsByClaim.get(claimId);
    if (!list || list.length === 0) {
      continue;
    }
    const latest = list.reduce((a, b) => (a.submittedTick >= b.submittedTick ? a : b));
    resolvedPairs.push({ probability: latest.probability, outcome });
  }

  const brierScore =
    resolvedPairs.length === 0 ? null : mean(resolvedPairs.map((p) => (p.probability - p.outcome) ** 2));

  const calibrationBins = buildCalibrationBins(resolvedPairs);

  const verificationInfoGain = computeVerificationInfoGain(claims, assessmentsByClaim, verificationResolvedTickByClaim);

  return {
    finalTick,
    phase,
    scoreTotal,
    populationRiskScoreContribution: categoryTotals.get("population_risk")!.total,
    infrastructureScoreContribution: categoryTotals.get("infrastructure")!.total,
    eventsHandledScoreContribution: categoryTotals.get("events_handled")!.total,
    eventsMissedScoreContribution: categoryTotals.get("events_missed")!.total,
    cascadeCount: categoryTotals.get("chain_failure")!.count,
    cascadePenalty: categoryTotals.get("chain_failure")!.total,
    wastedDispatchPenalty: categoryTotals.get("wasted_dispatch")!.total,
    falseAdvisoryCost: categoryTotals.get("misadvisory")!.total,
    decisionDelayPenalty: categoryTotals.get("decision_delay")!.total,
    resourceEfficiencyScore: categoryTotals.get("resource_efficiency")!.total,
    totalCommandsSubmitted,
    invalidCommandCount,
    invalidCommandRate: totalCommandsSubmitted === 0 ? 0 : invalidCommandCount / totalCommandsSubmitted,
    commandsByName: [...commandStats.values()].sort((a, b) => a.commandName.localeCompare(b.commandName)),
    responseLatencies: responseLatencies.sort((a, b) => a.claimId.localeCompare(b.claimId)),
    meanResponseLatencyTicks,
    assessmentCount,
    resolvedClaimCount: verifiedClaimCount + refutedClaimCount,
    verifiedClaimCount,
    refutedClaimCount,
    brierScore,
    calibrationBins,
    verificationInfoGain,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildCalibrationBins(pairs: ReadonlyArray<{ probability: number; outcome: 0 | 1 }>): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < 10; i += 1) {
    const rangeStart = i / 10;
    const rangeEnd = (i + 1) / 10;
    const inBin = pairs.filter((p) => (i === 9 ? p.probability >= rangeStart && p.probability <= rangeEnd : p.probability >= rangeStart && p.probability < rangeEnd));
    if (inBin.length === 0) {
      continue;
    }
    bins.push({
      rangeStart,
      rangeEnd,
      count: inBin.length,
      meanPredicted: mean(inBin.map((p) => p.probability)),
      empiricalFrequency: mean(inBin.map((p) => p.outcome)),
    });
  }
  return bins;
}

function computeVerificationInfoGain(
  claims: Map<string, ClaimTrack>,
  assessmentsByClaim: Map<string, AssessmentRecord[]>,
  verificationResolvedTickByClaim: Map<string, number>,
): number | null {
  const improvements: number[] = [];
  for (const [claimId, resolvedTick] of verificationResolvedTickByClaim) {
    const claim = claims.get(claimId);
    const outcome = claim ? outcomeLabel(claim.latestStatus) : null;
    if (outcome === null) {
      continue;
    }
    const list = assessmentsByClaim.get(claimId);
    if (!list || list.length === 0) {
      continue;
    }
    const before = list.filter((a) => a.submittedTick < resolvedTick);
    const after = list.filter((a) => a.submittedTick >= resolvedTick);
    if (before.length === 0 || after.length === 0) {
      continue;
    }
    const errorBefore = mean(before.map((a) => (a.probability - outcome) ** 2));
    const errorAfter = mean(after.map((a) => (a.probability - outcome) ** 2));
    improvements.push(errorBefore - errorAfter);
  }
  return improvements.length === 0 ? null : mean(improvements);
}

import type { DistrictState, ScoreState } from "@null-city/contracts/truth";
import { clamp } from "@null-city/contracts/truth";

/** Ticks an incident may go unanswered before the delay penalty starts. */
export const DECISION_DELAY_GRACE_TICKS = 15;
/** Points added per tick of delay beyond the grace window. */
export const DECISION_DELAY_POINTS_PER_TICK = 2;
/** Maximum delay points a single incident can contribute. */
export const DECISION_DELAY_MAX_POINTS_PER_INCIDENT = 50;

/**
 * Inputs to scoring, in their natural units.
 *
 * Audit finding P1-06: the inherited `ScoreState` stored *weighted point
 * contributions* in fields named like raw measurements (`eventsHandled` held
 * `10 × count`, `decisionDelayTicks` held penalty points). Raw measurements
 * now live in `ScoreState.raw` and every weighted component carries a
 * `...Points`/`...Cost` name.
 */
export interface ScoreMeta {
  /** count of incidents resolved */
  handledIncidents: number;
  /** count of incidents still active at completion */
  activeIncidentsAtEnd: number;
  /** count of chained failures */
  chainedIncidentCount: number;
  /** travel ticks discarded by cancel/re-route */
  wastedTicks: number;
  misadvisoryCost: number;
  remainingBackupGenerators: number;
  remainingAdvisories: number;
  /** accumulated decision-delay penalty in points (positive magnitude) */
  decisionDelayPenalty: number;
  /** summed ticks of delay across all started incidents */
  decisionDelayTicks: number;
  /** started incidents that have not yet received a qualifying action */
  incidentsWithoutAction: number;
}

export interface ScoreBreakdownDiff {
  id: string;
  label: string;
  delta: number;
  reason: string;
}

export interface ScoreComputation {
  score: ScoreState;
  diffs: ScoreBreakdownDiff[];
}

/**
 * Deterministic, explainable scoring. The breakdown list accumulates one
 * entry per component change, and `total` always equals the sum of the
 * breakdown (plus an explicit rounding adjustment when needed), so the
 * final number can always be decomposed.
 */
export function computeScore(
  districts: Record<string, DistrictState>,
  meta: ScoreMeta,
  previous: ScoreState,
  tick: number,
): ScoreComputation {
  const ds = Object.values(districts);
  const mean = (pick: (d: DistrictState) => number): number =>
    ds.length === 0 ? 0 : ds.reduce((acc, d) => acc + pick(d), 0) / ds.length;

  const finalPopulationRisk = mean((d) => d.populationRisk);
  const infrastructureAvailability = mean(
    (d) => (d.power + d.communications + d.water + d.traffic + d.medicalCapacity) / 5,
  );

  const resourceEfficiency = clamp(
    meta.remainingBackupGenerators * 2 + meta.remainingAdvisories * 3,
    0,
    20,
  );

  const candidates: Array<{ id: string; label: string; value: number }> = [
    { id: "population_risk", label: "Population Risk", value: -0.6 * finalPopulationRisk },
    { id: "infrastructure", label: "Infrastructure Availability", value: 0.3 * infrastructureAvailability },
    { id: "events_handled", label: "Events Handled", value: 10 * meta.handledIncidents },
    { id: "events_missed", label: "Events Missed", value: -15 * meta.activeIncidentsAtEnd },
    { id: "chain_failure", label: "Chain Failure Penalty", value: -25 * meta.chainedIncidentCount },
    { id: "wasted_dispatch", label: "Wasted Dispatch", value: -0.5 * meta.wastedTicks },
    { id: "misadvisory", label: "Wrong Advisory Cost", value: -1 * meta.misadvisoryCost },
    { id: "decision_delay", label: "Decision Delay", value: -1 * meta.decisionDelayPenalty },
    { id: "resource_efficiency", label: "Resource Efficiency", value: resourceEfficiency },
  ];

  const next: ScoreState = {
    total: 0,
    finalPopulationRisk: Math.round(finalPopulationRisk * 100) / 100,
    infrastructureAvailability: Math.round(infrastructureAvailability * 100) / 100,
    eventsHandledPoints: 10 * meta.handledIncidents,
    eventsMissedPoints: -15 * meta.activeIncidentsAtEnd,
    misadvisoryCost: -1 * meta.misadvisoryCost,
    wastedDispatchCost: Math.round(-0.5 * meta.wastedTicks * 100) / 100,
    decisionDelayPoints: -1 * meta.decisionDelayPenalty,
    resourceEfficiency,
    chainFailurePenalty: -25 * meta.chainedIncidentCount,
    raw: {
      incidentsHandled: meta.handledIncidents,
      incidentsMissed: meta.activeIncidentsAtEnd,
      chainedIncidents: meta.chainedIncidentCount,
      wastedDispatchTicks: meta.wastedTicks,
      decisionDelayTicks: meta.decisionDelayTicks,
      incidentsWithoutAction: meta.incidentsWithoutAction,
      remainingBackupGenerators: meta.remainingBackupGenerators,
      remainingAdvisories: meta.remainingAdvisories,
    },
    breakdown: [...previous.breakdown],
  };

  const diffs: ScoreBreakdownDiff[] = [];
  for (const c of candidates) {
    const accumulated = accumulatedDelta(previous, c.id);
    const delta = Math.round((c.value - accumulated) * 100) / 100;
    if (Math.abs(delta) > 0.009) {
      next.breakdown.push({
        id: c.id,
        label: c.label,
        delta,
        tick,
        reason: reasonFor(c.id, c.value, accumulated),
      });
      diffs.push({ id: c.id, label: c.label, delta, reason: reasonFor(c.id, c.value, accumulated) });
    }
  }

  const accumulatedTotal = next.breakdown.reduce((acc, b) => acc + b.delta, 0);
  const rawTotal =
    -0.6 * finalPopulationRisk +
    0.3 * infrastructureAvailability +
    10 * meta.handledIncidents +
    -15 * meta.activeIncidentsAtEnd +
    -25 * meta.chainedIncidentCount +
    -0.5 * meta.wastedTicks +
    -1 * meta.misadvisoryCost +
    -1 * meta.decisionDelayPenalty +
    resourceEfficiency;
  const roundedTotal = Math.round(rawTotal * 100) / 100;
  const drift = Math.round((roundedTotal - accumulatedTotal) * 100) / 100;

  if (Math.abs(drift) > 0.009) {
    next.breakdown.push({
      id: "adjustment",
      label: "Rounding Adjustment",
      delta: drift,
      tick,
      reason: "reconciles accumulated breakdown with exact score",
    });
  }

  next.total = Math.round(next.breakdown.reduce((acc, b) => acc + b.delta, 0) * 100) / 100;
  return { score: next, diffs };
}

/**
 * Decision-delay penalty for one incident, in points.
 *
 * `responseTick` is the first qualifying action tick, or the current tick
 * while the incident is still unanswered — an incident that is never acted on
 * accrues delay instead of being silently skipped (audit finding P1-06).
 */
export function decisionDelayPointsFor(delayTicks: number): number {
  if (delayTicks <= DECISION_DELAY_GRACE_TICKS) {
    return 0;
  }
  return Math.min(
    DECISION_DELAY_MAX_POINTS_PER_INCIDENT,
    (delayTicks - DECISION_DELAY_GRACE_TICKS) * DECISION_DELAY_POINTS_PER_TICK,
  );
}

function accumulatedDelta(previous: ScoreState, id: string): number {
  return previous.breakdown.filter((b) => b.id === id).reduce((acc, b) => acc + b.delta, 0);
}

function reasonFor(id: string, value: number, prev: number): string {
  const delta = Math.round((value - prev) * 100) / 100;
  const sign = delta >= 0 ? "increased" : "decreased";
  switch (id) {
    case "population_risk":
      return `population risk ${sign} (delta ${delta.toFixed(2)})`;
    case "infrastructure":
      return `infrastructure availability ${sign} (delta ${delta.toFixed(2)})`;
    case "events_handled":
      return `an incident was resolved`;
    case "events_missed":
      return `an incident was left unresolved`;
    case "chain_failure":
      return `a chained failure occurred`;
    case "wasted_dispatch":
      return `dispatch time wasted by cancel/re-route`;
    case "misadvisory":
      return `a public advisory caused harm`;
    case "decision_delay":
      return `reaction to a critical incident was delayed`;
    case "resource_efficiency":
      return `resource conservation changed`;
    default:
      return `score reconciled`;
  }
}

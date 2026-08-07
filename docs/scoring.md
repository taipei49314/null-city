# Scoring model

Deterministic, explainable scoring. `ScoreState.total` always equals the sum of
`breakdown[].delta` (plus an explicit rounding adjustment when needed).

## Metrics and weights

| Id | Label | Formula | Unit / meaning |
|---|---|---|---|
| `population_risk` | Population Risk | `-0.6 × mean(district.populationRisk)` | Lower risk → higher score |
| `infrastructure` | Infrastructure Availability | `0.3 × mean(avg of power/comms/water/traffic/medical)` | 0–100 scale attributes |
| `events_handled` | Events Handled | `+10 × resolved incident count` | Per resolved incident |
| `events_missed` | Events Missed | `-15 × still-active incidents at completion` | No-response through end |
| `chain_failure` | Chain Failure Penalty | `-25 × chained incident activations` | Cascade cost |
| `wasted_dispatch` | Wasted Dispatch | `-0.5 × wasted travel ticks` | Cancel / re-route waste |
| `misadvisory` | Wrong Advisory Cost | `-1 × misadvisory cost units` | Harmful public advisory |
| `decision_delay` | Decision Delay | `-1 × pre-weighted delay penalty` | See timeline below |
| `resource_efficiency` | Resource Efficiency | `clamp(2×gens + 3×advisories, 0, 20)` | Conservation bonus |

## Per-incident response timeline

Tracked against each active incident id (not district):

| Milestone | Meaning |
|---|---|
| observed | Observation recorded for the incident's district/subject |
| acknowledged | Player assessment or verification request referencing related claim |
| dispatched | First operational command targeting the incident's district |
| arrived | Team arrival at district with an applicable task |
| effective | Task produces an effect that reduces the incident pressure |
| resolved | Incident deactivated |

Decision-delay penalty keys off **first action tick per incident**:

- `firstActionTick` = the earlier of
  - the first dispatch/operational command targeting the incident's district while the incident is active, and
  - the first tick at which an applicable team is working that district (the *effective* milestone), which is what credits a team that was pre-positioned before the incident started;
- `delay = firstActionTick − incidentStartTick`;
- an incident that has **never** been acted on is charged against the current tick,
  i.e. `delay = currentTick − incidentStartTick`, so neglect accrues instead of being free;
- if `delay > 15`: add `min(50, (delay − 15) × 2)` to the pre-weighted penalty.

A penalty is fixed once the incident is acted on, and is retained after the
incident resolves — resolving an incident late does not erase the delay.

Resolved incidents cannot reactivate. Unresolved incidents at completion contribute to `events_missed`.

## Raw measurements vs weighted points

`ScoreState` keeps the two apart so neither can be misread as the other:

- `score.raw.*` holds unweighted measurements — `incidentsHandled`,
  `incidentsMissed`, `chainedIncidents`, `wastedDispatchTicks`,
  `misadvisoryCostUnits`, `decisionDelayTicks`, `incidentsWithoutAction`.
- The sibling `*Points` fields hold the weighted contribution actually summed
  into `total` — e.g. `eventsHandledPoints = 10 × raw.incidentsHandled` and
  `eventsMissedPoints = -15 × raw.incidentsMissed`.

`decisionDelayTicks` is the summed pre-weighted penalty across incidents, not a
wall-clock tick count for a single incident.

## Independent recomputation

Given a verified run receipt / event log:

1. Rebuild world via replay (or trust receipt fields for handled/active/chained counts).
2. Recompute `computeScore` from final district states + meta.
3. Confirm `breakdown` sum equals `total`.

Fixtures: `packages/simulation/test/scoring-fixtures.test.ts`.

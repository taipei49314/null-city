# M2 Workpack — Scenario Compiler and Simulation Correctness

## Objective

Create a deterministic scenario compilation boundary and correct known mechanical/scoring defects.

## Scenario compiler

- support the documented source format without arbitrary code execution;
- exact schema-version support;
- unique IDs across each namespace;
- valid references for districts, teams, routes, incidents, sources, observations, effects, and chain sources;
- no self-cycle or invalid chain cycle;
- corruption probability sum rules;
- bounded ticks, arrays, effects, and resource counts;
- route graph validation and canonical ordering;
- compile into immutable indexed internal representation;
- compute canonical scenario digest;
- provide precise path-aware diagnostics.

CLI:

- `nullcity scenario validate <path>`
- `nullcity scenario compile <path> --out <path>`
- `nullcity scenario inspect <path>`

## Mechanical correctness

- replace weighted BFS behavior with correct Dijkstra or equivalent;
- use a simple independent reference implementation in tests;
- fix incident reactivation and observation-lifecycle inconsistencies;
- define duration inclusion/exclusion semantics and test boundaries;
- clear route reopen metadata coherently;
- align event payload runtime schemas with actual payloads;
- make final-state digest include all state promised by its name or rename it.

## Scoring

- create a per-incident response timeline;
- distinguish observed/acknowledged/dispatched/arrived/effective/resolved ticks;
- penalize no-response incidents through completion;
- use field names and units that match values;
- document every metric and weight;
- provide an independent recomputation path from verified artifacts.

## Acceptance

Source scenarios cannot reach the engine without compilation. Randomized graph tests match the reference solver. Scoring fixtures demonstrate correct behavior for early action, late action, no action, wrong action, and effective arrival.

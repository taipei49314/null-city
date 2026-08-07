# ADR — M2 scenario compiler and weighted paths

## Status

Accepted for M2.

## Decision

1. Every `parseScenario` / `validateScenario` path runs semantic `compileScenario` producing a digest and indexes. Unsupported schema versions and reference errors fail closed.
2. `shortestTravelPath` uses Dijkstra on `travelTicks` (not hop-count BFS).
3. Decision-delay scoring keys first action by incident id, not district.
4. Resolved incidents cannot reactivate.
5. CLI: `nullcity-scenario validate|compile|inspect`.

## Consequences

- Already-compiled objects must strip metadata before re-validation.
- Snapshot field `firstActionTickByDistrict` is replaced by `firstActionTickByIncident`.

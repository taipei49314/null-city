/**
 * District identity is scenario-defined, not a fixed enum: each compiled
 * scenario carries its own authoritative district id set in
 * `indexes.districtIds` (see `@null-city/scenario-schema`), and every
 * reference (`teams[].startDistrict`, `routes[].from/to`, `incidents[].district`,
 * ...) is checked against that scenario-local set at compile time
 * (`compileScenario`), not against a global literal union. This keeps the
 * mechanics layer (this package, `@null-city/simulation`) reusable across an
 * unbounded set of scenarios without a source-code edit per scenario.
 */
export type DistrictId = string;
export type RouteId = string;
export type TeamId = string;

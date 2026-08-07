# ADR — M6 Scenario Suite and Authoring

## Status

Implemented for M6, awaiting owner acceptance.

## Decision

1. **`DistrictId` is widened from a fixed literal-union enum to a validated
   string, so a new scenario ships as pure JSON with no source-code edit.**
   `packages/contracts/src/ids.ts`'s `DistrictId` is now `string` (previously
   a union of Black-River-only district names); `DISTRICT_IDS` in
   `packages/contracts/src/types.ts` is kept only as a documentation
   constant, no longer the type's source of truth. `packages/scenario-schema`'s
   `districtIdSchema` enforces a lowercase-slug regex
   (`^[a-z][a-z0-9-]*$`) instead of `z.enum(DISTRICT_IDS)`, and
   `compileScenario` (`packages/scenario-schema/src/compile.ts`) separately
   checks that every district reference (`teams[].startDistrict`,
   `routes[].from/to`, `incidents[].district`, `effects[].target`,
   `chainTrigger.district`) resolves within *that scenario's own*
   `districts[]` — not a global set. This is the mechanism that makes Glass
   Harbor's and Signal Zero's districts (`harbor-front`, `medical-district`,
   `relay-station`, `dead-zone`, etc.) legal without touching
   `scenario-schema`, `simulation`, `server`, or `command-center` source.
   The one narrow ripple from widening the type: `packages/simulation/src/engine.ts`'s
   `backupActive: Partial<Record<DistrictId, number>>` now infers
   `Object.entries()` values as possibly `undefined` (an index-signature
   artifact of `Record<string, T>` vs. a literal union), requiring one
   explicit `undefined` guard; and two hardcoded `"central"` fallbacks were
   replaced with a generic `defaultDistrict()` (first district declared in
   the loaded scenario), since "central" is a Black-River-specific name with
   no meaning for the other two scenarios.

2. **Scenario `metadata` (difficulty/tags/expectedDurationMinutes/mechanics)
   is a first-class, optional schema field, not an authoring convention
   layered on top.** `scenarioMetadataSchema` (`packages/scenario-schema/src/index.ts`)
   is `.strict()`-validated Zod, included in `scenarioSchema` as
   `metadata?: ScenarioMetadata`, threaded through `compileScenario`'s
   `ScenarioSource` interface, and surfaced by `nullcity-scenario inspect`.
   All three shipped scenarios set it; the Command Center's launch/scenario
   picker (`apps/command-center/src/routes/LaunchPage.tsx`) reads `difficulty`
   and `tags` directly from each topology's declared metadata rather than a
   separate UI-only lookup table.

3. **Glass Harbor and Signal Zero are authored as pure `scenarios/*.json`,
   each deliberately exercising a different subset of the engine's existing
   mechanics so the three scenarios differ on all six workpack axes, not
   just narrative flavor.** Neither scenario required any change to
   `packages/simulation`'s engine logic beyond the two generic fixes in
   decision 1 — every distinguishing mechanic below is expressed purely
   through scenario JSON content:
   - **Glass Harbor** (`scenarios/glass-harbor.json`): a hazmat plume with
     uncertain, exaggerated/false-attributed citizen and news reports
     (`observations[].corruption` with `attribution_error`/`false: true`
     entries later debunked by a higher-reliability dispatch/medical
     source), medical-capacity pressure (`medicalCapacity` cascades into a
     chained `hospital-overload` incident), and route closures interacting
     with evacuation/advisory tradeoffs (`resources.advisoryUses` spent
     against `hazardLevel`/`populationRisk`).
   - **Signal Zero** (`scenarios/signal-zero.json`): comms degradation as
     the primary mechanic — `sources[]` includes low-reliability
     `automated` telemetry, and multiple `observations[]` set
     `degradedDelayMultiplier > 1` so delivery is throttled precisely when
     a district's `communications` attribute is degraded, compounded by
     spoofed-telemetry corruption entries and contradictory dispatch
     reports racing each other to the player. `verification`-type dispatch
     and `PRIORITIZE_COMMUNICATION` are disproportionately valuable here
     versus Black River or Glass Harbor.
   - **Black River** (existing, `scenarios/black-river.json`) keeps its
     original infrastructure-cascade identity (power/water dependency
     chains, delayed telemetry, citizen/news misinformation, backup
     generator tradeoff) and only gained the new optional `description`/
     `metadata` fields for suite consistency — no mechanical change.
   `packages/benchmark/test/distinctness.test.ts` is the executable proof
   of the six-axis requirement: dependency-graph shape (unique chain edges,
   no shared incident ids), observation-channel behavior (unique
   `degradedDelayMultiplier`/`attribution_error` usage per scenario, minimum
   source reliability), resource tradeoffs (differing
   `backupGenerators`/`advisoryUses` budgets and team-type composition),
   failure cascade membership (each scenario's `failureScript` activates a
   distinct, non-overlapping incident set), optimal baseline strategy
   (`verification-first`'s score edge over `reactive-greedy` is large and
   positive for Glass Harbor/Signal Zero, small and negative for Black
   River), and calibration/verification challenge (Signal Zero's
   `verification-first` run produces a measurably higher assessment load
   than Black River's).

4. **The scenario suite is enumerated by one small, explicit registry
   (`SCENARIO_IDS` in `packages/test-fixtures/src/index.ts`), not
   filesystem discovery of `scenarios/*.json`.** `loadScenario`,
   `goldenScriptFor`, and every CLI/verify/benchmark/topology consumer key
   off this array plus per-scenario `loadX()`/`xGoldenScript` exports. This
   is the one place a new scenario's id must be registered by hand — every
   other package (`scenario-schema`, `simulation`, `server`, `benchmark`,
   `command-center`) is generic over whatever a registered scenario's JSON
   declares, matching the "no source-code edit for normal scenario content"
   requirement while keeping "which scenario ids exist" an explicit,
   reviewable list rather than implicit directory-listing behavior with no
   golden-script/topology pairing guarantee.

5. **Command Center topology is generalized from a single hardcoded Black
   River module into a small per-scenario module + registry, structural
   data only.** `apps/command-center/src/topology/types.ts` defines
   `TopologyDistrict`/`TopologyRoute`/`ScenarioTopology`; `blackRiver.ts`
   (refactored), `glassHarbor.ts`, and `signalZero.ts` each declare only
   district ids/labels and route endpoints — no truth attribute values, per
   the player-facing epistemic boundary — and `registry.ts` exposes
   `getTopology(scenarioId)`/`findDistrict`/`districtLabel` plus the shared
   `TEAM_TYPE_LABELS`/`TEAM_TYPE_INITIAL` maps (team types are the one
   closed enum in the system, so these stay shared). `TopologyMap`,
   `CommandComposer`, `CommandCenterPage`, and `LaunchPage` all now take/derive
   a `topology: ScenarioTopology` prop instead of importing Black-River
   constants directly, and `LaunchPage` grew a scenario picker so a player
   chooses which of the three suite scenarios to launch.

6. **Server-side and CLI-side determinism/verification is a loop over
   `SCENARIO_IDS`, not a single hardcoded Black River path.**
   `packages/simulation/src/cli/verify.ts` and
   `packages/server/src/cli/verify.ts` both wrap their existing
   determinism/public-state check suites (same-seed determinism,
   different-seed divergence, replay equivalence, snapshot-resume, REST
   determinism/repeatability/resume, public-claim-model, projection-rebuild)
   in a loop over all three scenario ids with per-scenario session ids, so
   `pnpm verify:determinism`/`verify:server` cover the full suite rather
   than only Black River. `packages/server/test/transport-determinism.test.ts`
   uses `describe.each(SCENARIO_IDS)` for the same reason.
   `packages/benchmark/src/matrix.ts`'s `DEFAULT_SCENARIO_IDS` includes all
   three, and `verify:benchmark` runs the full
   3 scenarios × 3 policies × 1 seed matrix (`tick-step 30`) rather than a
   single-scenario slice, since three scenarios × three deterministic,
   non-LLM policies is still a fast, credential-free gate.

7. **Deterministic golden receipts are generated deliberately, never
   automatically, and independently re-derived on every `pnpm verify`.**
   `scripts/generate-golden-receipts.mjs` runs each scenario's own golden
   script at a fixed seed (`49314`) and writes
   `scenarios/golden-receipts/<scenarioId>.receipt.json` — a `RunReceipt`
   wrapped with `{format: "null-city-golden-receipt", version: 1,
   scenarioId, scenarioDigest, seed, referenceScript}`. It is a manual
   convenience script (`pnpm golden-receipts:generate`), not part of
   `pnpm verify`, since regenerating is a deliberate act with a diff that
   should be reviewed before committing. `scripts/verify-golden-receipts.mjs`
   (`pnpm verify:golden-receipts`, wired into `pnpm verify` immediately
   after `verify:scenarios`) is the actual gate: for each scenario it (a)
   independently re-verifies the committed receipt's own hash chain via
   `verifyReceipt`, (b) fails if the scenario's *current* compiled digest no
   longer matches the digest recorded in the committed receipt (catching a
   scenario edit that wasn't followed by a receipt regeneration), and (c)
   re-runs the golden script from source and fails if `receiptHash`,
   `eventLogHash`, `scoreTotal`, `finalTick`, `handledIncidents`, or
   `activeIncidents` diverge from what's committed. This is the mechanism
   that makes "golden receipts, versioned carefully" an executable claim
   rather than a static artifact nobody re-checks.

8. **Authoring documentation is one guide plus one runnable starter, not
   scattered doc-comments.** `docs/scenario-authoring.md` documents the
   full source schema field-by-field, the compiled format
   (`format`/`version`/`digest`/`indexes`, canonical ordering, digest
   derivation), the three-command CLI workflow (`validate`/`compile`/
   `inspect`), verified-against-the-real-CLI diagnostic examples for every
   category of compile-time error (unknown reference, duplicate id,
   self-loop route, chain cycle, corruption-probability overflow,
   atTick-beyond-horizon) and the one Zod parse-error example (invalid
   district slug), the metadata conventions, the golden-receipt
   generate/verify workflow, the distinctness gates, and the exact steps to
   wire a validated scenario into the full suite (test-fixtures registry,
   Command Center topology, golden receipt, `verify:scenarios`,
   `DEFAULT_SCENARIO_IDS`). `templates/SCENARIO_STARTER.json` is a minimal
   (2 districts, 1 route, 2 teams, 1 incident, 1 source, 1 observation, no
   chains) scenario that validates as-is, confirmed by
   `node packages/scenario-schema/dist/cli.js validate templates/SCENARIO_STARTER.json`
   during this milestone's verification.

## Consequences

- `DistrictId` being `string` means a typo'd district reference is now only
  caught at `compileScenario` time (a runtime diagnostic against *that*
  scenario's own declared districts), not at TypeScript compile time against
  a fixed enum. This trade-off is inherent to "no source-code edit for new
  scenario content" — a compile-time-checked union and per-scenario
  extensibility are mutually exclusive, and the workpack explicitly requires
  the latter.
- `SCENARIO_IDS` in `packages/test-fixtures` remains the one place a new
  scenario must be registered by hand (alongside a golden script and, for
  Command Center support, a topology module) — scenario *content* needs no
  source edit, but scenario *suite membership* is still an explicit,
  reviewable list rather than implicit directory scanning.
- `verify:benchmark`'s matrix grew from 1 scenario × 2 policies to 3
  scenarios × 3 policies (9 runs instead of 2); still completes in a few
  seconds at `tick-step 30` and remains credential-free.
- Golden receipts pin to a scenario's compiled `digest`, so any future
  scenario-content or engine change that legitimately alters a golden run's
  outcome will fail `verify:golden-receipts` until `golden-receipts:generate`
  is re-run and the new receipt is reviewed and committed — this is
  deliberate friction, not a bug.

## Unverified / deferred

- No fourth/community-contributed scenario was authored as part of this
  milestone beyond the starter template itself; the starter's "compiles
  as-is, extend incrementally" claim was verified by running it through the
  real CLI, not by a written walkthrough alone.
- The Command Center's scenario picker (`LaunchPage.tsx`) was verified via
  its existing component/typecheck test suite and manual reasoning about the
  registry wiring, not a browser E2E click-through of launching each of the
  three scenarios from the picker.
- `pnpm bench`'s full matrix beyond the fixed `verify:benchmark` slice
  (3 scenarios × 3 policies × 1 seed) was not run with additional seeds as
  part of this milestone.

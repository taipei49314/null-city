# Authoring a NullCity Scenario

This guide covers everything needed to add a **new scenario as pure JSON**
under `scenarios/`, with no edit to any package's source code. It documents
the source schema, the compiled format, the CLI workflow, common validation
errors, and the metadata/authoring conventions used by Black River, Glass
Harbor, and Signal Zero.

## Where scenarios live

- Source scenarios: `scenarios/*.json` (author-facing; hand-written or generated).
- Golden receipts: `scenarios/golden-receipts/*.receipt.json` (generated, see below).
- Schema + compiler: `packages/scenario-schema` (`Scenario` = Zod-validated source shape; `CompiledScenario` = source + `format`/`version`/`digest`/`indexes`).
- Starter template: `templates/SCENARIO_STARTER.json`.

Adding a scenario never requires touching `packages/scenario-schema`,
`packages/simulation`, or `packages/server` source — those packages are generic
over whatever `districts`, `teams`, `routes`, `incidents`, `sources`, and
`observations` a scenario JSON declares. The compiler, engine, server session
loading, CLI, SDK, MCP adapter, and benchmark matrices all read scenario
content, not a hardcoded id.

Two places still need a source addition, and both are honest exceptions rather
than oversights:

1. **Scenario registry** — `packages/test-fixtures/src/index.ts`'s
   `SCENARIO_IDS` array and its matching `loadScenario`/`goldenScriptFor`
   entries, because nothing enumerates `scenarios/*.json` without a manifest.
2. **Command Center topology** — `apps/command-center/src/topology/` holds a
   hand-authored map layout (district coordinates, route geometry, display
   name, blurb) per scenario, and the launch picker renders from
   `SCENARIO_TOPOLOGIES`. A scenario with no topology entry is fully playable
   through every other client but will not appear in the browser picker, and
   `getTopology` falls back to Black River's map. Deriving a readable map
   automatically from scenario JSON is not attempted in v0.1.

## Source schema (author-facing)

The Zod schema lives at `packages/scenario-schema/src/index.ts` (`scenarioSchema`).
Top-level shape:

```jsonc
{
  "schemaVersion": 1,            // must be one of SUPPORTED_SCHEMA_VERSIONS (currently just 1)
  "id": "your-scenario-id",      // free-form string, but by convention a lowercase-hyphen slug
  "name": "YOUR SCENARIO NAME",
  "description": "One paragraph: what's happening, why it's hard.",   // optional but recommended
  "metadata": {                                                        // optional but recommended
    "difficulty": "introductory" | "standard" | "advanced",
    "tags": ["short-kebab-tags", "..."],
    "expectedDurationMinutes": 20,
    "mechanics": ["named-mechanic-1", "named-mechanic-2"]
  },
  "tickDurationSeconds": 10,     // wall-clock seconds represented by one tick; default 10
  "totalTicks": 540,             // simulation horizon; hard ceiling 10000
  "districts": [ /* DistrictInit[] */ ],
  "teams": [ /* TeamInit[] */ ],
  "routes": [ /* RouteInit[] */ ],
  "resources": { "backupGenerators": 3, "advisoryUses": 4 },
  "incidents": [ /* IncidentInit[] */ ],
  "effects": [ /* EffectInit[] */ ],       // optional, defaults to []
  "sources": [ /* ObservationSource[] */ ],
  "observations": [ /* ObservationDef[] */ ]
}
```

### `districts[]` — `DistrictInit`

Each district is a bag of 0–100 attributes the simulation evolves over time:

```jsonc
{ "id": "central", "power": 96, "communications": 92, "water": 92, "traffic": 80, "medicalCapacity": 85, "hazardLevel": 5, "populationRisk": 10 }
```

- `id` must be a **lowercase slug**: `^[a-z][a-z0-9-]*$`, 1–64 chars. District
  ids are entirely scenario-defined — there is no fixed global district enum.
  Every other reference to a district (`teams[].startDistrict`, `routes[].from/to`,
  `incidents[].district`, `effects[].target`, `chainTrigger.district`) is
  checked at compile time against this scenario's own `districts[]` and must
  resolve, or you get a diagnostic (see below).
- All seven numeric fields are required and clamped `0..100`.

### `teams[]` — `TeamInit`

```jsonc
{ "teamId": "power-1", "type": "power", "startDistrict": "central", "reschedulable": true }
```

- `type` must be one of the fixed team types: `power`, `fire`, `medical`,
  `communications`, `verification` (`TEAM_TYPES` in `@null-city/contracts`).
  These are the only "closed enum" in the schema, because the simulation and
  UI have fixed handling per team type.
- `reschedulable` defaults to `true`.

### `routes[]` — `RouteInit`

```jsonc
{ "id": "central-industrial", "from": "central", "to": "industrial", "travelTicks": 6, "capacity": 100 }
```

- No self-loops (`from !== to`), both ends must be declared districts.
- `capacity` defaults to `100` and is clamped `0..100`.

### `resources`

```jsonc
{ "backupGenerators": 3, "advisoryUses": 4 }
```

Two scenario-wide budgets players spend against; both are integers, ceiling 100.

### `incidents[]` — `IncidentInit`

The core cascade-authoring primitive. Each incident fires at a tick (or is
chained off another incident) and applies a repeating attribute delta to a
district while active:

```jsonc
{
  "id": "substation-fault",
  "kind": "power-fault",
  "district": "industrial",
  "atTick": 30,
  "severity": 70,
  "effect": { "attribute": "power", "delta": -6 },
  "handledBy": ["power"]
}
```

- `handledBy` lists team *types* whose dispatch to this incident can satisfy it.
- **Chained incidents** trigger off another incident's sustained effect
  instead of a fixed tick — this is how cascades are authored:

```jsonc
{
  "id": "hospital-power-crisis",
  "kind": "power-fault",
  "district": "medical",
  "atTick": 100000,              // sentinel: never fires on the clock, only via chainTrigger
  "severity": 85,
  "effect": { "attribute": "power", "delta": -10 },
  "handledBy": ["power"],
  "chainTrigger": {
    "sourceIncidentId": "substation-fault",
    "district": "medical",       // optional; defaults to the chained incident's own district
    "attribute": "power",
    "below": 60,
    "forTicks": 20
  }
}
```

  A chained incident fires once its `sourceIncidentId` is active **and** the
  monitored `district`'s `attribute` has stayed below `below` for `forTicks`
  consecutive ticks. Chain-only incidents conventionally use a sentinel
  `atTick` far beyond `totalTicks` so they can't also fire on the clock — the
  compiler *does* allow `atTick > totalTicks` specifically when a
  `chainTrigger` is present. The chain graph is checked for cycles at compile
  time.

### `effects[]` — `EffectInit` (optional)

One-shot or repeating scripted attribute nudges independent of any incident
(ambient drift, scripted narrative beats):

```jsonc
{ "atTick": 200, "target": "central", "attribute": "traffic", "delta": -5, "repeatEvery": 20, "label": "rush hour" }
```

### `sources[]` — `ObservationSource`

```jsonc
{ "id": "citizen-reports", "kind": "public", "reliability": 0.55 }
```

`kind` is one of `sensor`, `human`, `dispatch`, `medical`, `public`, `news`,
`automated`. `reliability` (`0..1`) is a hint used by scoring/benchmark
analysis, not the raw corruption probability (see `observations[].corruption`).

### `observations[]` — `ObservationDef`

The channel through which players learn about an incident — delayed, lossy,
and sometimes corrupted:

```jsonc
{
  "id": "citizen-report-1",
  "sourceId": "citizen-reports",
  "incidentId": "substation-fault",
  "baseDelayTicks": 8,
  "lossProbability": 0.1,
  "degradedDelayMultiplier": 1,
  "staleAfterTicks": 60,
  "content": "Power flickering near the industrial substation.",
  "category": "report",
  "atTick": 0,
  "relativeToIncidentStart": true,
  "corruption": [
    { "probability": 0.2, "type": "exaggerated", "text": "Explosion reported at the substation!", "false": false },
    { "probability": 0.1, "type": "attribution_error", "text": "Water main break blamed for the outage.", "false": true }
  ]
}
```

- `atTick` + `relativeToIncidentStart`: if `true`, `atTick` is ticks *after*
  the referenced incident activates; if `false`, it's an absolute tick.
- `degradedDelayMultiplier` (`>= 1`) is the lever for "comms degradation"
  mechanics: when > 1, delivery of this observation is multiplied by this
  factor whenever the district's `communications` attribute is degraded —
  this is Signal Zero's signature mechanic.
- `corruption[]` probabilities must sum to `<= 1`; the remainder is the
  chance the observation arrives with its plain `content`. Each corruption
  entry has a `type` (for analysis) and a `false` flag — `false: true` marks
  entries that are outright wrong (misattribution/misdirection), as opposed
  to merely `exaggerated`/`understated` framing of a true event. Glass
  Harbor's false-attribution mechanic and Signal Zero's spoofed-telemetry
  mechanic are both authored purely through this table plus a low-reliability
  `automated`/`sensor` source.

## Compiled format

`compileScenario()` (`packages/scenario-schema/src/compile.ts`) takes a
schema-valid source object and:

1. Runs semantic checks beyond what Zod alone can express: id uniqueness
   within each collection, every district/incident/source reference resolves
   within *this* scenario, no route self-loops, corruption probabilities sum
   `<= 1`, chain-trigger graph has no cycles, `totalTicks`/resource ceilings.
2. Canonically sorts every collection (by id, or by `atTick` then `target`
   for `effects[]`) so the compiled artifact is order-independent.
3. Computes a `digest` — `sha256(canonicalJson(orderedScenario))` — a content
   hash of the compiled scenario (excluding the wrapper fields below).
4. Wraps the ordered scenario with:
   ```jsonc
   { "format": "nullcity-scenario", "version": 1, "digest": "<sha256 hex>",
     "indexes": { "districtIds": [...], "teamIds": [...], "routeIds": [...],
                  "incidentIds": [...], "sourceIds": [...], "observationIds": [...] } }
   ```

`parseScenario`/`validateScenario` accept either a raw source file **or** an
already-compiled one (they strip `format`/`version`/`digest`/`indexes` before
re-validating), so re-validating a compiled artifact round-trips safely.

The `digest` is what golden receipts pin against (see below): if you edit a
scenario's content, its digest changes, and `verify:golden-receipts` will
fail loudly rather than silently comparing a stale reference run against a
scenario that no longer matches it.

## CLI workflow

```bash
# Validate: parse + compile, print PASS + digest, or FAIL + diagnostics.
node packages/scenario-schema/dist/cli.js validate scenarios/your-scenario.json

# Compile: write the full compiled artifact (with format/version/digest/indexes) to --out.
node packages/scenario-schema/dist/cli.js compile scenarios/your-scenario.json --out data/your-scenario.compiled.json

# Inspect: print id/name/description/metadata/digest/totalTicks/indexes/schemaVersion as JSON.
node packages/scenario-schema/dist/cli.js inspect scenarios/your-scenario.json
```

Or via the package scripts:

```bash
pnpm scenario:validate scenarios/your-scenario.json
pnpm scenario:compile scenarios/your-scenario.json --out data/your-scenario.compiled.json
pnpm scenario:inspect scenarios/your-scenario.json
```

`pnpm verify:scenarios` runs `validate` against all three shipped scenarios;
add your new scenario's path to that script (in `package.json`) once it's
ready to be gated by CI.

## Diagnostic examples (common errors)

All compile-time diagnostics are printed as `FAIL compile diagnostics:` followed by one `<path>: <message>` line per problem. Zod parse errors (wrong type, missing required field, failed regex) surface as a single `error: ...` line from the Zod error message instead. Examples:

**Unknown district reference** (typo'd `startDistrict`, or district removed but still referenced):

```
FAIL compile diagnostics:
  teams.power-1.startDistrict: unknown district centrall
```

**Duplicate id** (two incidents/teams/routes/etc. sharing an id):

```
FAIL compile diagnostics:
  incidents: duplicate id substation-fault
```

**Route self-loop:**

```
FAIL compile diagnostics:
  routes.central-central: route cannot be a self-loop
```

**Chain-trigger cycle** (incident A chains from B which chains from A):

```
FAIL compile diagnostics:
  incidents.chainTrigger: chain trigger graph contains a cycle
```

**Corruption table over-budget** (probabilities sum above 1):

```
FAIL compile diagnostics:
  observations.citizen-report-1.corruption: corruption probability sum 1.15 exceeds 1
```

**District id fails the slug regex** (uppercase, space, leading digit) — this
is a Zod parse error, not a compile diagnostic:

```
error: [
  {
    "code": "invalid_string",
    "message": "district id must be a lowercase slug (a-z, 0-9, -), starting with a letter",
    "path": [ "districts", 0, "id" ]
  }
]
```

**`atTick` beyond horizon without a chain trigger:**

```
FAIL compile diagnostics:
  incidents.late-incident.atTick: atTick exceeds totalTicks
```

## Starter template

Copy `templates/SCENARIO_STARTER.json` to `scenarios/your-scenario-id.json`,
rename `id`/`name`, and grow it incrementally, validating after every change:

```bash
cp templates/SCENARIO_STARTER.json scenarios/your-scenario-id.json
pnpm scenario:validate scenarios/your-scenario-id.json
```

The starter is intentionally minimal (2 districts, 1 route, 2 teams, 1
incident, 1 source, 1 observation, no chains) — it compiles as-is, so you
always have a known-good baseline to diff against while iterating.

## Wiring a new scenario into the suite

Once your scenario JSON validates, to make it a first-class suite member
(discoverable by CLIs, benchmark, and Command Center, not just hand-run via
`scenario:validate`):

1. `packages/test-fixtures/src/index.ts`: add a `loadYourScenario()` export,
   a `yourScenarioGoldenScript` (a scripted sequence of commands that reaches
   a reasonable outcome — see existing golden scripts for the shape), add the
   id to `SCENARIO_IDS`, and wire both into `goldenScriptFor`.
2. `apps/command-center/src/topology/`: add `yourScenario.ts` (structural
   `ScenarioTopology` only — district ids/labels and route endpoints, no
   truth attribute values), and register it in `topology/registry.ts`.
3. Generate its golden receipt: `pnpm golden-receipts:generate` (regenerates
   *all* scenarios' receipts — review the diff before committing).
4. Add its path to `verify:scenarios` in `package.json`, and to
   `DEFAULT_SCENARIO_IDS` in `packages/benchmark/src/matrix.ts` if you want
   it included in default benchmark runs.
5. Run `pnpm verify` end to end.

## Metadata conventions

`metadata` is optional but every shipped scenario sets it, since it drives
scenario selection in the Command Center launch picker and benchmark
reporting:

- `difficulty`: `"introductory" | "standard" | "advanced"` — coarse signal
  for a first-time player, not a formal score.
- `tags`: short kebab-case labels for filtering/search (e.g.
  `"infrastructure-cascade"`, `"comms-degradation"`, `"false-attribution"`).
- `expectedDurationMinutes`: a human's rough wall-clock playtime estimate,
  informational only (never consumed by the simulation core).
- `mechanics`: named gameplay mechanics this scenario exercises, used by the
  distinctness-gate tests and docs (`packages/benchmark/test/distinctness.test.ts`)
  to cross-check that the shipped suite is not three skins on one mechanic.

## Deterministic golden receipts

Each suite scenario has a committed, versioned reference run at
`scenarios/golden-receipts/<scenarioId>.receipt.json`: that scenario's own
golden script, run once at a fixed seed, wrapped with the scenario's digest
and the receipt itself (`format: "null-city-golden-receipt"`, `version: 1`).

- `pnpm golden-receipts:generate` (`scripts/generate-golden-receipts.mjs`)
  regenerates all three from source. Run this **deliberately**, review the
  diff, and only commit it when a scenario/engine change intentionally
  changes a reference outcome — the diff of a regenerated receipt *is* the
  changelog entry for "why did the reference run change".
- `pnpm verify:golden-receipts` (`scripts/verify-golden-receipts.mjs`, also
  run as part of `pnpm verify`) re-derives every scenario's golden run from
  source and fails if it diverges from what's committed, and independently
  re-verifies each committed receipt's own hash chain via `verifyReceipt`.
  It also fails if a scenario's current digest no longer matches the digest
  recorded in its committed golden receipt, so a scenario edit that wasn't
  followed by a receipt regeneration is caught immediately rather than
  passing on a stale comparison.

## Distinctness gates

`packages/benchmark/test/distinctness.test.ts` asserts the six axes required
by the M6 workpack differ across all three shipped scenarios: dependency
graph shape, observation channel behavior, resource tradeoffs, failure
cascade membership, optimal baseline strategy (policy ranking/edge), and
calibration/verification challenge (assessment load). Read that file for the
current concrete thresholds; a fourth scenario should be checked against (or
extend) the same six axes rather than adding a scenario that's mechanically
redundant with an existing one.

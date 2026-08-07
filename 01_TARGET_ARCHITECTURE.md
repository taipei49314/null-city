# NullCity Target Architecture

## Preserve before replacing

The current project already contains useful assets:

- a TypeScript/pnpm monorepo;
- contracts, scenario schema, simulation, server, and test-fixture packages;
- a seeded PRNG and tick clock;
- a scenario-driven engine;
- command handling, incidents, observation corruption/delay/loss, teams, routes, resources, and scoring;
- canonical JSON and event hashing;
- snapshot/replay concepts;
- meaningful tests;
- `Black River` as the first scenario.

The rebuild must not discard working behavior merely to create a cleaner-looking tree. Refactor only when a milestone contract requires it.

## Target repository tree

```text
null-city/
├─ apps/
│  └─ command-center/          # React/Vite human client + Replay Lab
├─ packages/
│  ├─ contracts/               # runtime schemas and public/internal protocol types
│  ├─ simulation/              # deterministic kernel; no network/fs/LLM/wall clock
│  ├─ epistemics/              # claims, evidence, assessments, player projection
│  ├─ scenario-kit/            # structural schema + semantic compiler + CLI
│  ├─ server/                  # sessions, stores, REST/WS, finalization
│  ├─ sdk/                     # public TypeScript PlayerSession client
│  ├─ benchmark/               # policy runner, baselines, metrics, reports
│  ├─ mcp-server/              # optional MCP adapter over sdk/public server API
│  └─ testkit/                 # fixtures, reference models, leak/fuzz/property helpers
├─ scenarios/
│  ├─ black-river/
│  ├─ glass-harbor/
│  └─ signal-zero/
├─ examples/
│  ├─ heuristic-policy/
│  └─ verify-run/
├─ docs/
│  ├─ architecture/
│  ├─ authoring/
│  ├─ benchmark/
│  ├─ protocol/
│  └─ threat-model.md
├─ .github/
├─ AGENTS.md
└─ README.md
```

Package creation is milestone-driven. Do not create empty packages as placeholders.

## Dependency direction

```text
contracts
   ↑
scenario-kit ───────→ simulation
   ↑                    ↑
epistemics ─────────────┤
   ↑                    │
sdk ← server ───────────┘
 ↑       ↑
benchmark mcp-server
 ↑
command-center
```

Rules:

- `simulation` never imports server, SDK, UI, MCP, external model providers, filesystem, or wall-clock APIs.
- `command-center`, `sdk`, `benchmark`, and `mcp-server` never import internal truth contracts.
- `server` is the only package allowed to hold both truth and public stores in one process.
- public projection is derived from public events, not by reading truth and masking fields ad hoc.
- scenario source is compiled before engine construction.
- no cyclic package dependencies.

## Contract split

### Internal contracts

Only the kernel, scenario compiler, and trusted server internals may use:

- `TruthWorldState`
- `TruthEvent`
- `CompiledScenarioInternal`
- `EngineSnapshot`
- internal incident/effect queues
- truth event store

### Public contracts

Clients and agents may use only:

- `PlayerSessionState`
- `PlayerEvent`
- `Observation`
- `Claim`
- `Evidence`
- `Assessment`
- `OwnTeamState`
- `KnownRouteState`
- `CommandRequest` / `CommandResult`
- `RunSummary`
- completed-run replay artifacts explicitly released after finalization

Use package export maps and lint restrictions so public packages cannot import internal paths.

## Truth and public event streams

The current single event envelope must become two explicit streams.

```ts
interface TruthEventEnvelope<T extends TruthEventPayload> {
  stream: "truth";
  sessionId: string;
  sequence: number;
  tick: number;
  kind: TruthEventKind;
  payload: T;
  previousHash: string;
  hash: string;
}

interface PlayerEventEnvelope<T extends PlayerEventPayload> {
  stream: "player";
  sessionId: string;
  sequence: number;
  tick: number;
  kind: PlayerEventKind;
  payload: T;
  previousHash: string;
  hash: string;
}
```

A `PlayerEvent` may reveal:

- a delivered report and its source metadata;
- the player’s own accepted/rejected command;
- the status/location/ETA of teams the player controls;
- explicit verification results;
- public advisories and acknowledged effects;
- completion summary.

It may not reveal:

- unobserved incidents;
- current truth attributes merely because a district is “known”;
- hidden random draws;
- internal queues/counters;
- raw truth event payloads;
- truth snapshots;
- future scenario schedule.

## Epistemic model

The player state is an event-sourced projection of evidence and actions.

```ts
type ClaimStatus =
  | "reported"
  | "corroborated"
  | "contested"
  | "verified"
  | "refuted"
  | "stale";

interface Claim {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  districtId?: string;
  incidentId?: string;
  firstObservedTick: number;
  lastUpdatedTick: number;
  status: ClaimStatus;
  evidenceIds: string[];
}

interface Assessment {
  claimId: string;
  probability: number; // 0..1
  confidence: number;  // 0..1, separately reported
  rationale?: string;
  submittedTick: number;
}
```

Reports create or update claims. Corroboration changes claim status only through public evidence rules. Verification targets a claim or explicit question, not an entire district. The UI must display “as of tick” and source provenance.

## Kernel phases

Refactor the current monolithic engine only as needed into deterministic phases with explicit input/output:

1. validate and accept due commands;
2. schedule scenario incidents/effects;
3. advance teams and operations;
4. apply world effects and cascade rules;
5. generate observation-channel events;
6. update incident response timelines;
7. compute metrics and score deltas;
8. emit canonical events;
9. finalize once at the terminal tick.

Each phase receives deterministic state and seeded PRNG state. Any future-output-affecting state must exist in the snapshot schema.

## Compiled scenario

Source JSON/YAML is not passed directly to the engine.

```ts
interface CompiledScenario {
  format: "nullcity-scenario";
  version: 1;
  sourceSchemaVersion: number;
  id: string;
  digest: string;
  metadata: ScenarioMetadata;
  districts: readonly CompiledDistrict[];
  routes: readonly CompiledRoute[];
  teams: readonly CompiledTeam[];
  incidents: readonly CompiledIncident[];
  observations: readonly CompiledObservation[];
  effects: readonly CompiledEffect[];
  indexes: Readonly<ScenarioIndexes>;
}
```

Compilation must enforce uniqueness, references, cycle rules, probability sums, resource ceilings, supported versions, route validity, and deterministic canonical ordering.

## Snapshot

A snapshot is a versioned serialized value, never a live object reference.

Required bindings:

- snapshot format/version;
- engine protocol version;
- scenario id and canonical digest;
- session id;
- seed and PRNG state;
- tick and phase;
- complete future-output-affecting engine state;
- event sequence counters and terminal status;
- snapshot digest.

Resume validates structure, integrity, identity, scenario digest, and event-chain invariants before constructing an engine.

## Run artifact

A completed run exports a canonical `.ncrun` bundle or JSON envelope.

Minimum fields:

```ts
interface RunReceipt {
  format: "nullcity-run";
  version: 1;
  engine: { version: string; protocolVersion: number };
  scenario: { id: string; digest: string };
  session: { id: string; seed: number };
  terminal: {
    tick: number;
    truthLogHash: string;
    playerLogHash: string;
    finalStateDigest: string;
    scoreDigest: string;
  };
  commandTraceDigest: string;
  receiptHash: string;
  signature?: {
    algorithm: "ed25519";
    publicKeyId: string;
    value: string;
  };
}
```

An unsigned receipt is called tamper-evident, not authenticated. Signature verification is optional but, when present, must use a trusted public key supplied outside the receipt itself.

## Replay semantics

Use precise names:

- **event-log verification** validates a supplied event stream against schemas, stream identity, sequence, ticks, hashes, and trusted anchors;
- **command-trace re-simulation** reruns the deterministic engine from commands;
- **state replay** reduces verified events into projections;
- **counterfactual branch** starts from a verified snapshot and applies a different command trace.

Do not call command extraction alone a trusted event replay.

## Public PlayerSession API

The browser, SDK, benchmark, and MCP adapter share one interface:

```ts
interface PlayerSession {
  getState(): Promise<PlayerSessionState>;
  getEvents(afterSequence?: number): Promise<PlayerEventEnvelope[]>;
  submitCommand(command: CommandRequest): Promise<CommandResult>;
  submitAssessment(assessment: AssessmentRequest): Promise<AssessmentResult>;
  advance?(ticks: number): Promise<AdvanceResult>; // local benchmark mode only
  getCompletedRun(): Promise<CompletedRunSummary | null>;
}
```

No method returns truth during an active run.

## Command Center

Desktop-first layout:

- left: SVG city topology and route/team status;
- center: evidence feed, claim board, and incident hypotheses;
- right: command composer, resources, verification queue;
- bottom: simulation clock, alerts, and later replay scrubber.

Post-run Replay Lab adds:

- truth overlay;
- belief/assessment history;
- synchronized player/truth timelines;
- score breakdown with causal links;
- run comparison;
- receipt verify/download.

Use actual runtime data. No hard-coded screenshots, fake metrics, or fixture-only UI paths.

## Benchmark architecture

A policy sees `PlayerSessionState` and returns public commands/assessments.

```ts
interface Policy {
  id: string;
  reset(context: PolicyContext): Promise<void>;
  decide(input: PolicyInput): Promise<PolicyDecision>;
  close?(): Promise<void>;
}
```

Ship at least:

- `no-op` baseline;
- `reactive-greedy` baseline;
- `verification-first` baseline.

Metrics must be transparent and independently recomputable:

- outcome and infrastructure preservation;
- population risk;
- response latency by incident stage;
- invalid/rejected command rate;
- resource and dispatch efficiency;
- false-advisory cost;
- chain failures;
- assessment calibration, including Brier score when assessments exist;
- verification information gain.

LLM adapters record provider/model/configuration and action traces, but are optional and never required for tests.

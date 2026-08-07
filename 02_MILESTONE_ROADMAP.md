# NullCity Milestone Roadmap

## Operating rule

Each milestone is a separately reviewable contract. Cursor implements one milestone at a time, produces evidence, inspects the full diff, and stops. Later-milestone code is scope drift unless required to satisfy the current acceptance criteria.

Statuses are `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN`. A command that was not executed is never PASS.

---

## M0 — Kernel Recovery Vertical Slice

**Goal:** turn the inherited alpha into one trustworthy, complete CLI run of `Black River`.

Required outcomes:

- all three inherited P0 defects fixed;
- completed sessions reject every mutation deterministically;
- snapshot values are immutable and resume-equivalent after chained incidents;
- server cannot expose raw truth events or snapshots through player routes;
- event-chain verifier enforces genesis, contiguous sequence, stream/session identity, monotonic tick, schemas, and trusted terminal/root input;
- one CLI path runs a scenario to completion and exports a verifiable run receipt;
- package build exports point to `dist` and a production start path exists;
- M0 has a real end-to-end test, not a scaffold.

**Death gate:** if arbitrary-tick snapshot/resume or truth-boundary black-box tests fail, stop. No UI work begins.

Workpack: `workpacks/M0-kernel-recovery.md`

---

## M1 — Epistemic Boundary and Evidence Model

**Goal:** replace masked truth views with a genuine claim/evidence projection.

Required outcomes:

- distinct truth and player event types/stores;
- player state built only from player events;
- observations create claims with provenance and “as of” time;
- verification targets a claim/question and emits auditable player events;
- assessment API with probability/confidence history;
- compile-time import restrictions plus runtime leak tests across REST and WS;
- the same public state contract can drive a CLI client.

**Death gate:** any client path can infer unobserved truth from API payloads, future schedule, internal counters, or snapshots.

Workpack: `workpacks/M1-epistemic-boundary.md`

---

## M2 — Scenario Compiler and Simulation Correctness

**Goal:** make scenarios safe, inspectable, and mechanically correct.

Required outcomes:

- semantic scenario compiler with canonical digest;
- ID/reference/cycle/probability/resource validation;
- correct weighted shortest path with reference tests;
- per-incident response timeline and corrected scoring units;
- incident lifecycle and duration edge cases fixed;
- randomized/property tests for graph, snapshot, compiler, and event invariants;
- `nullcity scenario validate|compile|inspect` commands.

**Death gate:** source scenario reaches the engine without successful compilation, or reference-model tests disagree.

Workpack: `workpacks/M2-scenario-and-correctness.md`

---

## M3 — Command Center Vertical Slice

**Goal:** deliver one polished human-play flow using only the public contract.

Required outcomes:

- real React/Vite app under `apps/command-center`;
- scenario start, clock controls, evidence feed, claim board, city topology, team/resource controls, command submission, and completion summary;
- no direct imports from simulation/internal contracts;
- keyboard-accessible core flow and responsive desktop layout;
- component/unit tests plus browser E2E against a real local server;
- `pnpm demo` starts server and UI in a clean checkout.

**Death gate:** UI relies on fixture-only state, hidden truth, mocked completion, or manual server setup not documented by the command.

Workpack: `workpacks/M3-command-center.md`

---

## M4 — Replay Lab and Run Artifacts

**Goal:** make NullCity’s main differentiator visible.

Required outcomes:

- finalized `.ncrun` artifact;
- receipt verification CLI;
- synchronized truth/player/assessment timelines after completion;
- truth-versus-belief map and claim history;
- score breakdown linked to source events;
- compare two runs with same scenario and different command traces;
- command-trace re-simulation proves deterministic equivalence;
- optional signing is clearly separated from hash-chain integrity.

**Death gate:** a completed run changes after receipt generation, or the viewer accepts a tampered artifact as valid.

Workpack: `workpacks/M4-replay-lab.md`

---

## M5 — SDK, Benchmark, and MCP

**Goal:** make the same environment usable by agents without creating an agent-only backdoor.

Required outcomes:

- typed TypeScript SDK implementing `PlayerSession`;
- policy runner and three deterministic non-LLM baselines;
- JSON and Markdown benchmark reports;
- calibration and operational metrics independently recomputable from artifacts;
- MCP adapter over the SDK/public API only;
- parity tests proving browser, SDK, benchmark, and MCP receive equivalent public information;
- optional model-provider example outside default test path.

**Death gate:** any adapter accesses truth/internal endpoints or benchmark success depends on an API key.

Workpack: `workpacks/M5-agent-benchmark.md`

---

## M6 — Scenario Suite and Authoring Experience

**Goal:** prove this is a platform rather than one hard-coded demo.

Required outcomes:

- `Black River` polished and migrated to compiled format;
- `Glass Harbor`: hazardous-material event with contradictory public reports and route tradeoffs;
- `Signal Zero`: communications degradation, spoofed telemetry, verification pressure;
- distinct mechanics and baseline behavior across all three;
- scenario authoring guide, schema reference, validation errors, and example templates;
- deterministic golden receipts for stable reference policies.

**Death gate:** scenarios are reskins with identical decision structure or require code edits to author normal content.

Workpack: `workpacks/M6-scenario-suite.md`

---

## M7 — Public Repository and Release Engineering

**Goal:** produce a repository that survives first contact with an outside developer.

Required outcomes:

- high-quality README with actual screenshots/GIF and honest claims;
- architecture, protocol, threat model, benchmark, and scenario docs;
- LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, CITATION.cff;
- CI for lint, typecheck, unit, integration, E2E, build, package smoke, and deterministic verification;
- Dockerfile/Compose or equivalent one-command local path;
- package tarball install/start smoke test;
- release archive and checksums;
- no generated files, secrets, audit shims, or local paths accidentally committed.

**Death gate:** fresh clone cannot reproduce the documented demo and verification commands.

Workpack: `workpacks/M7-public-release.md`

---

## M8 — Adversarial Release Candidate

**Goal:** challenge the project’s claims instead of reviewing its appearance.

Required outcomes:

- independent review of truth boundaries, snapshot/resume, finalization, event integrity, scenario compiler, transport scoping, and packaging;
- mutation/adversarial tests for each public promise;
- cross-platform fresh-clone runs where supported;
- release gate filled with evidence paths, commands, exit codes, and unresolved risks;
- no open P0/P1 defects against release claims;
- tag only after review acceptance.

**Death gate:** any release claim lacks an executable falsification test or evidence artifact.

Workpack: `workpacks/M8-adversarial-rc.md`

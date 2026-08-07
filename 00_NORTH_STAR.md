# NULL CITY — North Star

## One-line description

**A deterministic, partially observable crisis-response sandbox for testing decisions under uncertainty.**

## Public tagline

> **What you know is not what happened.**

## Product thesis

Most agent demos reward fluent action in environments where the model can read the state directly. NullCity tests a harder and more realistic problem: acting while the world is hidden, reports arrive late, sources disagree, resources are constrained, and early decisions can trigger cascading failures.

The simulation kernel remains deterministic. Uncertainty comes from the scenario and observation channels, not from hidden wall-clock behavior or an LLM inside the engine. An LLM is an optional player, never the source of truth.

## Target users

1. **Agent builders** who need an executable benchmark for tool use, verification discipline, calibration, and long-horizon planning.
2. **Simulation and reliability engineers** who want reproducible scenario runs and inspectable failure chains.
3. **Developers and researchers** who need a TypeScript-first environment with human and agent parity.
4. **Open-source users** who want a polished local demo that is meaningful without API keys.

## The GitHub showcase moment

A new user runs one command, opens the Command Center, and plays `Black River`:

1. A city topology appears, but most state is unknown.
2. Reports arrive from sensors, dispatch, media, and citizens. Some are delayed, incomplete, or false.
3. The player forms assessments, requests verification, dispatches teams, reroutes power, and issues advisories.
4. Cascading infrastructure failures evolve deterministically from the scenario and actions.
5. At completion, the result freezes.
6. Replay Lab reveals a synchronized comparison of:
   - what was true,
   - what the player knew at each tick,
   - what the player believed,
   - which action changed the outcome.
7. The run exports a `.ncrun` receipt that another machine can verify and replay.
8. The same scenario can be run by a heuristic baseline or an AI agent through the same public interface.

A README GIF should communicate this loop in under 30 seconds.

## Six product promises

### 1. Hard truth boundary

Player-facing code cannot import or receive truth-state types. Truth and public events are separate contracts, stores, and transport paths. Redaction is not a UI convention; it is an architectural boundary with black-box leak tests.

### 2. Reproducible world

Given the same compiled scenario, engine version, seed, initial snapshot, and command trace, the engine produces byte-identical canonical events and terminal digests.

### 3. Epistemic gameplay

The player works with claims and evidence, not a magically updated truth dashboard. Each claim has provenance, observation time, delivery time, status, confidence, and verification history.

### 4. Verifiable completion

A completed run is immutable. It emits one terminal event and one run receipt. Tamper evidence and authenticity claims are kept distinct: a hash chain is not called a signature.

### 5. Human/agent parity

The browser client, TypeScript SDK, benchmark policies, and MCP adapter all consume the same `PlayerSession` contract. No agent-only truth endpoint exists.

### 6. Local-first usefulness

The default demo requires no account, external database, cloud service, or model key. Optional model adapters are outside the deterministic core.

## Differentiation

NullCity is not an AI social town, a population-scale synthetic society, a generic MARL game suite, or a static prompt benchmark. Its identity is:

- operational crisis response rather than social role-play;
- strict truth/belief separation rather than shared global state;
- deterministic replay receipts rather than merely stored transcripts;
- human/agent interface parity rather than agent-only evaluation;
- scenario compilation and executable invariants rather than prose-only cases;
- post-run truth-versus-belief analysis rather than a single opaque score.

## Product surfaces

### NullCity Kernel

Pure deterministic simulation, compiled scenarios, commands, internal events, snapshots, scoring, and replay.

### NullCity Command Center

Desktop-first web interface for human play and live observation.

### NullCity Replay Lab

Timeline scrubber, truth-versus-belief reveal, causality inspection, run comparison, and receipt verification.

### NullCity Bench

Policy runner, baseline agents, metrics, JSON/Markdown reports, and model metadata capture.

### NullCity Scenario Kit

Schema, semantic compiler, validation CLI, scenario inspection, and authoring documentation.

### NullCity MCP / SDK

Optional adapters that expose only the public player contract to external agents.

## v0.1 public-release scope

Required:

- repaired deterministic kernel;
- hard truth boundary;
- immutable completion;
- versioned snapshot and run receipt;
- claim/evidence player model;
- one polished end-to-end Command Center scenario;
- Replay Lab truth reveal;
- three executable scenarios total;
- TypeScript SDK;
- three non-LLM baseline policies;
- MCP adapter using the same public contract;
- CI, Docker, docs, screenshots, release artifacts, and fresh-clone proof.

Not required for v0.1:

- hosted leaderboard;
- authentication or accounts;
- multiplayer;
- cloud persistence;
- 3D or open-world city rendering;
- LLM-generated scenario logic;
- real emergency-service integration;
- native desktop app;
- plugin marketplace;
- production emergency-use claims.

## Release claim

The repository may claim:

> NullCity is an open-source, local-first crisis decision benchmark with deterministic replay, strict information boundaries, human/agent parity, and verifiable run artifacts.

It may not claim real-world emergency readiness, cryptographic authenticity without a trusted signing flow, or benchmark fairness beyond the scenarios and metrics actually shipped.

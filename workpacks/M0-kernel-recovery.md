# M0 Workpack — Kernel Recovery Vertical Slice

## Objective

Repair the inherited alpha enough to support one trustworthy, production-built, end-to-end CLI run of `Black River` that can complete, export a receipt, and be independently verified.

## In scope

### A. Reproduce and test inherited P0s

Create regression tests for:

- raw truth exposure through every player REST/WS path;
- snapshot live-reference mutation;
- snapshot/resume divergence after at least one chained incident;
- resume identity/scenario/seed mismatch;
- post-completion mutation for every command;
- event verifier accepting bad genesis/sequence/session/tick/schema.

### B. Finalization

- establish an explicit terminal state;
- make all post-completion mutating operations return deterministic rejections;
- freeze/copy terminal state and score;
- emit exactly one terminal event;
- compute stable terminal truth/player log hashes and state/score digests;
- ensure repeated reads produce identical results.

### C. Snapshot v1

- define runtime schema and exact version;
- include every future-output-affecting field;
- serialize/canonicalize into a detached value;
- deep-clone or deserialize on resume;
- bind engine protocol, scenario id/digest, session id, seed, tick, phase, PRNG, counters, and event state;
- validate before engine construction;
- reject foreign/extra/invalid structures with controlled errors;
- document actual atomic-save guarantees honestly.

### D. Event verification

Create an API that validates:

- nonempty/allowed genesis rules;
- stream type;
- session identity;
- sequence start and contiguity;
- monotonic tick;
- runtime event schema by kind;
- previous hash and current hash;
- expected terminal/root hash supplied by caller when verifying authenticity/inclusion.

Rename APIs/docs if needed so command-trace re-simulation is not represented as trusted event replay.

### E. Player transport containment

For M0, it is acceptable to expose a conservative minimal player event/state surface before the full M1 epistemic redesign. It is not acceptable to return raw events, raw snapshots, unobserved incidents, internal state, or exact unobserved district truth.

Admin/audit routes, if retained, must be separate, explicit, disabled from the player transport by construction, and tested. Do not invent authentication in M0.

### F. Real CLI vertical slice

Provide a documented command that:

1. loads and validates `Black River`;
2. runs with a seed and deterministic command script or baseline trace;
3. optionally snapshots/resumes during a chained incident;
4. completes exactly once;
5. writes a canonical run receipt/artifact;
6. verifies the artifact in a separate process/command;
7. exits nonzero on verification failure.

### G. Build/package baseline

- package exports refer to built JS/declarations;
- clean/build/start scripts are coherent;
- production Node can start without a TypeScript loader where the package claims production output;
- temporary tarball install/import/start smoke test for the M0 CLI/server surface.

## Out of scope

- full claim/evidence model;
- browser app;
- Replay Lab UI;
- SDK, benchmark framework, MCP;
- new scenarios;
- hosted services/auth/database;
- broad visual or naming redesign;
- optional signatures beyond the minimal receipt integrity design.

## Required tests

1. Parameterized post-completion test over all commands.
2. Snapshot immutability test.
3. Snapshot/resume matrix across pre-incident, active incident, chained incident, post-resolution, and near-completion ticks.
4. Resume mismatch tests for session, seed, scenario id, scenario digest, version, and event chain.
5. Black-box endpoint/WS leak tests with forbidden key/kind/value assertions.
6. Event verifier adversarial cases.
7. End-to-end CLI receipt generation and separate verification.
8. Pack/install/import/start smoke test.

## Acceptance criteria

- inherited P0 reproductions fail before fixes and pass after fixes;
- no player surface returns raw truth/snapshot data;
- arbitrary sampled snapshot/resume runs are byte-identical at completion;
- completed runs are immutable under every mutation attempt;
- tampered receipts/events are rejected;
- `Black River` CLI vertical slice works using built artifacts;
- lint, typecheck, tests, build, deterministic verify, server verify, and package smoke are actually run;
- `STATUS.md` and `EVIDENCE.md` are complete;
- Cursor stops after M0.

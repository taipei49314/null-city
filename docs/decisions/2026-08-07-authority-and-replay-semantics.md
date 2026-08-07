# ADR — Authority model for snapshots, artifacts, and replay

## Status

Accepted. Implements the repair for external audit findings P0-01, P0-02,
P1-01 and P1-05 (`docs/audits/2026-08-07-integrity-repair.md`).

## Context

An independent audit of the v0.1.0 candidate returned FAIL on two integrity
claims that this project makes in public documentation:

1. **Snapshot resume was an unauthenticated authority transfer.** `POST
   /sessions` accepted a caller-supplied `resume` snapshot. The engine
   validated that snapshot thoroughly — protocol version, session binding,
   seed, scenario digest, sequence counter, and the full embedded truth hash
   chain — and then adopted its `world`, `score`, `prngState`, resource
   counters, and idempotency keys wholesale. Every one of those checks is a
   *self-consistency* check. An attacker editing the snapshot offline runs the
   same code the verifier does, so they can recompute every hash and every
   digest. The audit demonstrated a session created with an arbitrary world
   state and a perfect chain.

2. **Artifact verification was hash-consistency only.** `verifyRunArtifact()`
   checked that the embedded chains hashed correctly and that the header
   matched them. It did not check that the *shape* of the run was legal. The
   audit produced five artifacts (ART-01..ART-05) that all verified: forged
   identity plus forged `stateDigest`; a removed `RunCompleted`; an event
   appended after `ScenarioCompleted`; an array substituted for a payload; and
   a negative genesis tick.

The common root cause is that the project treated *tamper evidence* as if it
were *authority*. A hash chain proves a byte sequence was not edited after it
was hashed. It says nothing about who produced it or whether the values inside
it were ever reachable by the simulation.

## Decision

### 1. Authority comes from the engine, never from the caller

There are exactly two ways to obtain a session state this build treats as
authoritative:

- run the deterministic engine forward from `(scenario, seed)` and a sequence
  of commands, or
- adopt a snapshot that a **trusted in-process caller** hands over.

"Trusted in-process caller" means code running inside the server process:
the local CLI, a test harness, an embedding application. It explicitly does
not mean "an HTTP client that can reach the port".

Concretely:

- `session.create` rejects `resume` on the public surface with `forbidden`.
- Resume moved to `admin.resume`, reachable only through `handleAdminRpc`.
- `handleRpc(hub, request)` defaults to the `public` surface; the REST and
  WebSocket adapters both pass `"public"` explicitly, and the WebSocket
  adapter additionally refuses any `admin.*` op.
- `session.snapshot` stays rejected on the public surface, as before.

**Rejected alternative: sign the snapshot.** A signature would make resume
safe over the network, but it requires a key, key distribution, and a trust
root. `00_NORTH_STAR.md` puts auth and key management out of scope for v0.1,
and a self-signed key held by the same process that validates it would be
theatre. Removing the surface is the honest fix at this scope.

**Rejected alternative: validate the snapshot harder.** No amount of
validation distinguishes a legitimate snapshot from a forged one when the
attacker has the validator's source. The audit already proved this
empirically. Additional checks would raise the cost of forgery without
changing the security property, while making the code look safer than it is.

### 2. Artifact verification checks legality, not just consistency

`verifyRunArtifact()` now enforces the structural rules that a real run
satisfies by construction:

- exactly one `ScenarioStarted`, and it is truth event 0;
- exactly one `ScenarioCompleted`, and it is the **final** truth event, so
  nothing may follow the terminal event (ART-03);
- exactly one `SessionStarted` as player event 0 and exactly one
  `RunCompleted` as the final player event (ART-02);
- identity cross-binding: `sessionId`, `scenarioId`, `seed` and `totalTicks`
  in the header must agree with both `ScenarioStarted` and `SessionStarted`;
  `finalTick` and score must agree with `ScenarioCompleted` and `RunCompleted`;
  `finalTick` must equal `totalTicks` (ART-01);
- command-trace completeness: commands issued with no outcome, duplicate
  command ids, and outcomes for never-issued commands are all reported.

Payload validation moved into the chain verifier itself, so a non-object
payload (ART-04) or a negative tick (ART-05) fails the stream, not just the
artifact.

Cross-binding does not make forgery impossible — it makes it require a set of
mutually consistent lies rather than one. That is a real increase in cost and
it is all a self-contained verifier can offer.

### 3. `stateDigest` is verified by deterministic replay, or reported unverified

`SimulationEngine.finalStateDigest` was a partial digest: districts, teams and
score, but not resources, routes, observation state, or the counters that
feed scoring. A forger could therefore change resources freely.

The digest is now versioned (`STATE_DIGEST_VERSION`) and covers every value
that can affect future output. That closes the omission but not the underlying
problem: the digest is a value inside the artifact, so a forger recomputes it.

The only thing that cannot be recomputed offline is a re-simulation. So
`verifyRunArtifact(artifact, { scenario })` re-runs the scenario from
`seed` + the recorded command trace and requires the regenerated truth log
hash, terminal state digest, score, and final tick to match. `pnpm
verify:artifact-cli` and the Replay Lab pass the compiled scenario, so the
shipped verification path exercises it.

When no scenario is supplied the result reports `replayChecked: false`, and
`{ requireReplay: true }` turns that into a failure. **The verifier states
what it did not check instead of implying full verification.**

### 4. Admin resume rebuilds the player view from truth — a documented loss

The engine snapshot embeds the full truth log, so `SessionHub.resume` replays
it through a fresh `TruthToPlayerBridge` and the resumed session's player view
is complete and correct for everything derived from truth: evidence, claims,
own-team state, known routes, public score, resources.

Player-originated records are **not** restored, because they never existed in
the truth log: submitted assessments, verification resolutions, and command
results are player-stream events produced at the transport boundary. After an
admin resume:

- `player.events` is a freshly derived stream, so `playerLogHash` differs from
  the pre-snapshot session's hash;
- the assessment trace is empty until new assessments are submitted;
- scoring, world state, and every truth-derived value are unaffected, which is
  why `transport-determinism.test.ts` can still assert a byte-identical
  outcome for the run itself.

**Rejected alternative: persist the player event log inside the snapshot.**
The snapshot is a truth-side artifact owned by the deterministic core, and the
player stream is produced by the epistemics bridge above it. Embedding one in
the other would put player-facing data into the core's serialized form and
invert the dependency the whole architecture is built on. Since public resume
is gone, the only consumer is a trusted operator restarting a run, for whom a
rebuilt player view is adequate. This is recorded as a known limitation rather
than silently accepted.

## Consequences

- A session can no longer be created at an arbitrary state over the network.
  Any tool that relied on public `resume` must move in-process.
- Artifacts produced before this change do not verify: baseline artifacts and
  golden receipts were regenerated. Terminal ordering changed (operational
  updates are now emitted before `RunCompleted`), so player log hashes changed.
- Artifact verification without a scenario is now explicitly weaker than with
  one, and says so.
- Resumed sessions have a different `playerLogHash` than the session they were
  snapshotted from. This is expected and documented above.

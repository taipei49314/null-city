# Threat model

This maps NullCity's public claims (`00_NORTH_STAR.md`'s six product
promises) to concrete assets, trust boundaries, plausible attacks, and the
mitigation actually shipped in code — cross-referenced to the test that
would fail if the mitigation regressed. It is scoped to this repository as
shipped: a local-first tool with no hosted deployment, no accounts, and no
production-emergency claim (see "Non-goals" below).

## Assets

| Asset | Why it matters |
|---|---|
| Truth world state (`TruthWorldState`, `EngineSnapshotData`) | The entire epistemic-gameplay premise depends on this never reaching a player/agent before completion. |
| Hidden RNG / PRNG state | Reconstructing future draws would let a player predict "random" future events, defeating uncertainty. |
| Another session's state | Session isolation is the multi-tenant boundary even in a single local process. |
| A completed run's terminal result | "Verifiable completion" requires it cannot be altered after the fact. |
| The scenario/engine/receipt version and digest bindings | A tampered or mismatched scenario must not silently produce a "valid"-looking run. |

## Trust boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│ Trusted process boundary: @null-city/server                 │
│                                                               │
│   SessionHub ── SimulationEngine (truth) ── epistemics bridge│
│                                        │                      │
│                                        ▼                      │
│                              player event store (public)      │
└───────────────────────┬───────────────┬──────────────────────┘
                         │ REST         │ WS
                         ▼               ▼
        ┌────────────────────────────────────────────┐
        │ Untrusted clients (equal footing):           │
        │ browser (command-center), @null-city/sdk,    │
        │ @null-city/benchmark policies, MCP tool caller│
        └────────────────────────────────────────────┘
```

Everything left of the REST/WS boundary is trusted-process-internal.
Everything right of it — human browser, SDK caller, benchmark policy, MCP
agent — is treated as an untrusted client with **identical** capabilities;
there is no privileged/admin variant of the protocol reachable from outside
the process (`admin.snapshot` exists only as an in-process RPC op, never
routed by `http.ts`/`ws.ts`).

## Attacks and mitigations

### 1. Read truth through a player-facing response

- **Attack:** any REST/WS/SDK/MCP/browser response leaking a truth field
  (raw district attributes, an unobserved incident, PRNG state, an internal
  queue) that lets a client infer ground truth ahead of an in-fiction
  report.
- **Mitigation:** `PlayerSessionState` is built only by folding the player
  event log (`projectPlayerState`), never by masking truth
  (`docs/architecture.md`). `packages/epistemics/src/leak.ts#detectPublicLeak`
  scans serialized payloads for truth-only markers
  (`TrueIncidentOccurred`, `prngState`, `"stream":"truth"`, raw district
  attribute patterns, etc.).
- **Evidence:** `packages/server/test/player-leak.test.ts`,
  `packages/sdk/test/leak.test.ts`, `packages/mcp-server/test/leak.test.ts`
  — each scans every payload across a full golden-script run and asserts
  zero hits.

### 2. Reach a truth/admin operation from outside the process

- **Attack:** call `GET /sessions/:id/snapshot`, or send `{"op":"admin.snapshot"}`/
  `{"op":"session.snapshot"}` over WS, hoping for a raw engine snapshot.
- **Mitigation:** both transports explicitly special-case and reject these
  before reaching `handleRpc`'s general dispatch (`http.ts`'s dedicated
  `403` branch; `ws.ts`'s dedicated `forbidden` branch), and `handleRpc`
  itself rejects `session.snapshot` even if reached.
- **Evidence:** `packages/server/test/rpc.test.ts`, `ws.test.ts`.

### 3. Cross-session read/write

- **Attack:** address another session's state/events/commands via its id,
  or send a WS `sessionId` in an `rpc` message that differs from the
  socket's own bound session.
- **Mitigation:** every REST route is keyed by the `:id` path segment
  against `SessionHub`; WS enforces the connection's bound `sessionId`
  and rejects a mismatched `params.sessionId` with `forbidden` before
  dispatch.
- **M8 defect (fixed):** REST built its params as `{ sessionId, ...body }`,
  so a body field overrode the path and `POST /sessions/A/command` with
  `{"sessionId":"B"}` drove session B. The order is now `{ ...body, sessionId }`
  on every route, making the URL authoritative and matching the rule WS already
  enforced.
- **Accepted limitation (P2):** `GET /sessions` / `session.list` enumerates
  every live session id to any local client. The server is unauthenticated and
  loopback-only by design, so any process that can call this endpoint can
  already call every other one — session ids are identifiers, not capabilities,
  and authentication is an explicit v0.1 non-goal (`00_NORTH_STAR.md`). This
  becomes **P1 for any shared or hosted deployment**, where session ids would
  have to become unguessable capabilities or sit behind real authentication.
- **Evidence:** `packages/server/test/http.test.ts`, `ws.test.ts`,
  `packages/server/test/adversarial-transport.test.ts` (regression, proven to
  fail on the inherited behaviour), and attacks A2-01…A2-08 in
  `data/evidence/m8-adversarial/report.md`.

### 4. Mutate a completed run

- **Attack:** submit a command, assessment, or advance after
  `phase === "completed"`, hoping to change the terminal score/state.
- **Mitigation:** the engine (`SimulationEngine`) and the RPC layer both
  reject with `run_completed`/an engine-level completed guard; the run
  artifact/summary is immutable once built.
- **M8 defect (fixed, P0):** the engine correctly refused the command, but the
  server kept going and the bridge appended a `CommandResult` **player** event
  afterwards. That moved `playerLogHash`, the player event count, and the
  exported artifact hash *after* the terminal event — so a completed run was
  observably mutable through the public API even though its score never
  changed. `rpc.ts` now answers post-completion commands before the
  verification queue, engine, and bridge are touched.
- **Evidence:** parameterized completed-run mutation tests in
  `packages/simulation/test/finalization.test.ts`;
  `packages/server/test/adversarial-immutability.test.ts` (regression, proven
  to fail on the inherited behaviour); attacks A3-00…A3-11 in
  `data/evidence/m8-adversarial/report.md`.

### 5. Fetch the terminal artifact/summary before completion

- **Attack:** call `session.summary`/`session.artifact` mid-run hoping for
  an early or fabricated result.
- **Mitigation:** both reject with `409 not_completed` until
  `phase === "completed"`.
- **Evidence:** `apps/command-center/e2e/smoke.mjs` (black-box, real
  server), `packages/server/test/rpc.test.ts`.

### 6. Malformed, oversized, or adversarial input

- **Attack:** non-JSON body, oversized body, wrong-typed field, unknown
  command name, malicious/huge scenario JSON.
- **Mitigation:** `http.ts#readJson` caps request bodies at 1 MiB and
  rejects non-object/invalid JSON with `400 invalid_body`; every RPC
  parameter is validated (`asString`/`asNumber` in `rpc.ts`) before use;
  scenario source is validated end-to-end by a zod schema
  (`packages/scenario-schema`) before it ever reaches the engine, with
  bounded totals (`totalTicks` ceiling 10000, etc.); the MCP adapter caps
  every list/event response (`packages/mcp-server/src/limits.ts`:
  `MAX_EVENTS_PER_CALL`/`MAX_LIST_ITEMS` = 200, `MAX_RATIONALE_LENGTH` =
  2000) and reports `truncated`/`total` rather than silently dropping data.
- **M8 defects (fixed):** (a) malformed percent-encoding in a session path
  (`/sessions/%E0%A4%A/state`) threw `URIError` and surfaced as a 500
  `internal_error`; it now returns 400 `invalid_params`. (b) An oversized body
  was rejected *without draining the request stream*, leaving the keep-alive
  connection desynchronised so the next request on that socket died with
  `ECONNRESET`; `readJson` now drains a bounded remainder
  (`MAX_DRAIN_BYTES`) and returns a clean 413, destroying the socket only when
  the sender exceeds the drain cap. (c) Unknown scenario ids returned
  `internal_error` rather than `invalid_params`.
- **Accepted limitation (P3):** there is no ceiling on concurrent sessions —
  60 were created in A6-07 with no cap, each holding a full engine and event
  log. Only reachable from loopback, where memory can be exhausted more
  simply, and a cap would break the benchmark matrix, which legitimately opens
  many sessions. Revisit for any shared deployment.
- **Evidence:** `packages/server/test/http.test.ts`,
  `packages/scenario-schema/test/*.test.ts`,
  `packages/mcp-server/test/parity.test.ts`'s bound-honoring assertions,
  `packages/server/test/adversarial-transport.test.ts`,
  `packages/scenario-schema/test/adversarial-scenario.test.ts`, and attacks
  A5-01…A5-11 / A6-01…A6-11 in `data/evidence/m8-adversarial/report.md`.

### 7. Replay/tamper with an exported artifact or receipt

- **Attack:** feed a hand-edited event log, wrong-sequence event, or
  mismatched scenario digest to the verifier and hope it is accepted.
- **Mitigation:** `verifyEventStream`/`verifyReceipt`
  (`packages/contracts`, `packages/simulation/src/receipt.ts`) check
  schema, stream identity, session id, contiguous sequence, monotonic
  tick, and the full hash chain against a trusted terminal/root value; a
  scenario digest mismatch is rejected before an engine is even
  constructed on resume.
- **M8 defect (fixed, P1):** those verifiers were not reached on the *resume*
  path. `validateResumeBinding` checked identity binding (seed, scenario
  digest, session, protocol version) but never the embedded truth log itself,
  so public `session.create` accepted a caller-supplied snapshot whose events
  failed their own hash chain and whose `sequence` header disagreed with the
  event count. The chain and sequence checks now run inside
  `validateResumeBinding`, which is the one boundary the CLI and the public
  REST transport both pass through.
- **Residual, by design:** a forged chain that is *self-consistent* — rebuilt
  with the real hash function — is still accepted, because tamper-evidence
  without a trusted root cannot distinguish it from a genuine log. A4-22 and
  A4-25 confirm the boundary sits exactly where §8 and the README say it does.
  This
  is a documented limitation, not a defect; closing it requires the signing
  flow described in §8.
- **Evidence:** `packages/simulation/test/replay.test.ts`,
  `packages/simulation/test/snapshot-resume.test.ts`,
  `packages/simulation/test/adversarial-resume.test.ts` (regression, proven to
  fail on the inherited behaviour), `verify:golden-receipts`/
  `verify:determinism` in `pnpm verify`, and attacks A4-01…A4-25 in
  `data/evidence/m8-adversarial/report.md`.

### 8. Present a hash chain as a signature

- **Attack:** a doc, UI label, or report claims a receipt is
  cryptographically authenticated/signed when it is only tamper-evident.
- **Mitigation:** this is a documentation/UX discipline, not a code check —
  every doc in this repository (README, `docs/protocol.md`, `01_TARGET_ARCHITECTURE.md`)
  says "tamper-evident, not a signature" explicitly, and the optional
  `signature` field on `RunReceipt` is never populated by default code.
- **Evidence:** manual review is the gate here; see the release-gate row
  "Honest integrity terminology" in `03_RELEASE_GATE.md`.

### 9. Supply-chain / dependency risk

- **Attack:** a compromised or vulnerable transitive dependency.
- **Mitigation:** `pnpm-lock.yaml` is committed and both local `pnpm install`
  and CI use `--frozen-lockfile` (no silent version drift). Dependency
  surface is intentionally small (`zod`, `ws`, `@modelcontextprotocol/sdk`
  for the kernel/server/MCP side; React/React Router/Vite for the browser
  app only).
- **Evidence / accepted findings:** `pnpm audit --prod` (see `EVIDENCE.md`
  for the exact command/output) reports 3 moderate advisories, all in
  `react-router`/`react-router-dom` (open-redirect / arbitrary-constructor
  advisories), reachable only via `apps/command-center`'s client-side
  routing. **Accepted for this milestone**: this app is a client-only SPA
  with no server-side rendering and no user-controlled redirect target
  (`react-router-dom` is used for local, hardcoded route definitions in
  `apps/command-center/src/App.tsx`, not for rendering an attacker-supplied
  URL), so the advisories' actual attack surface does not apply to how this
  app uses the library. Bumping `react-router-dom` to a patched major
  version is a real fix but is a dependency/API-surface change outside
  M7's scope (`AGENTS.md`'s "no opportunistic refactor") and is tracked as
  a known risk in `STATUS.md`, not silently ignored.

### 10. Packaging/tarball tampering or drift

- **Attack:** a published/packed artifact silently includes source, dev
  tooling, or excludes the built `dist/`, breaking the "built exports only"
  claim, or a release archive is corrupted/tampered with in transit.
- **Mitigation:** every package's `"files": ["dist"]` field constrains
  `npm pack` regardless of `.gitignore`; `pnpm verify:tarball-smoke` packs,
  extracts, and imports real tarballs and fails on a leaked `src/` or a
  missing `dist/index.js`. `scripts/release-archive.mjs` emits a SHA-256
  checksum alongside the release archive so a downloader can detect
  corruption/tampering in transit (again: tamper-evidence, not authenticity
  — nothing here proves *who* produced the archive without an external
  signing key).
- **Evidence:** `pnpm verify:tarball-smoke` (wired into `pnpm verify`).

## Non-goals (explicitly out of scope)

Per `00_NORTH_STAR.md`'s v0.1 scope: authentication/accounts, multiplayer,
cloud persistence, a hosted leaderboard, and any real-world
emergency-service integration. This threat model does not cover
multi-tenant hosting hardening, rate limiting against a hostile public
internet deployment, or resistance to a compromised host machine — none of
these are claims this project makes.

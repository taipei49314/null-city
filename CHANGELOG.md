# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project intends to follow [Semantic Versioning](https://semver.org/)
once a first tagged release exists.

No release has been tagged yet. Everything below is present in this working
tree under version `0.1.0` in `package.json`, pending independent re-review of
the external release audit response (see `03_RELEASE_GATE.md`) before any tag
is cut.

## [Unreleased]

### Fixed — external release audit repair (2026-08-07)

An independent audit of the v0.1.0 candidate returned **FAIL** with 2 P0, 9 P1
and 4 P2 findings. All 15 are closed; the finding-by-finding matrix, including
the two residual limitations that are bounded rather than removed, is in
`docs/audits/2026-08-07-integrity-repair.md`.

- **Snapshot resume is no longer a public operation.** `POST /sessions` and the
  player WebSocket accepted a caller-supplied `resume` snapshot and adopted its
  world state, score, PRNG state and event counters as authoritative. Because a
  forger recomputes the hash chain, the previously added chain check could not
  detect this. Resume is now an in-process/admin operation (`admin.resume`);
  the public surface rejects it with `403 forbidden`. **Breaking** for any
  caller that resumed over HTTP.
- **Run artifacts are verified semantically, not just by hash.** The verifier
  accepted a forged identity with a matching `stateDigest`, a removed
  `RunCompleted`, an event appended after `ScenarioCompleted`, an array
  payload, and a negative genesis tick. It now enforces terminal ordering and
  singleton start/completion events on both streams, cross-binds every identity
  field against the start and completion payloads, reports command-trace
  anomalies, and — when given the scenario — re-simulates the run to confirm
  the terminal digest.
- **The player stream ends with `RunCompleted`.** Operational updates for the
  final tick were emitted after it, so the shipped baseline artifacts ended in
  `OwnTeamUpdated`.
- **`finalStateDigest()` covers the whole simulation state** (resources,
  orders, observation queues, PRNG state, counters) and is versioned. It
  previously omitted enough state that two materially different runs could
  share a digest.
- **Event payloads are validated per kind at the chain boundary**, rejecting
  arrays, negative ticks, and kind-specific nonsense that the previous
  "non-null object" check allowed.
- **Score fields say what they hold.** `eventsHandled` contained `10 × count`
  and `decisionDelayTicks` contained penalty points; raw measurements and
  weighted contributions are now separate, and an incident that is never
  answered accrues delay instead of being silently skipped. `docs/scoring.md`
  was rewritten to match the implementation.
- **`session.advance` reports the true tick delta** (540, not 539, when
  advancing into completion).
- **Verification targeting follows command acceptance.** `pendingClaimVerify`
  was written before the engine saw the command, so a rejected command still
  retargeted the claim, and any `working` verification team could resolve it.
- **`@null-city/contracts` is split into `./public` and `./truth`,** so the
  player/truth boundary is enforced by module resolution rather than by
  convention.
- **The release archive ships an allowlist.** It previously tarred the working
  tree with a few excludes and would have shipped a local `.env`.
- **Docker publishes to `127.0.0.1`** instead of every interface.
- **Compiled scenarios are deep-frozen**, the WebSocket enforces a payload
  ceiling and a slow-client policy, route reopen clears stale closure metadata
  (retaining a `closureHistory`), and the README's "new scenarios are pure
  JSON" claim is narrowed to exclude the Command Center, which hardcodes three
  topology modules.
- **A non-string `op` on the WebSocket no longer crashes the server** — found
  while adding the payload bounds above.

### Fixed — M8: Adversarial release candidate

An independent adversarial sweep of 91 attacks against the running server
found 16 defects (5 P0, 7 P1, 2 P2, 2 P3). All 12 P0/P1 are fixed, each pinned
by a regression test mechanically proven to fail on the inherited behaviour
(`node scripts/adversarial/prove-regressions.mjs`).

- **Completed runs are now genuinely immutable.** A command submitted after a
  run completed still appended a `CommandResult` player event, which moved
  `playerLogHash`, the player event count, and therefore the exported run
  artifact's hash *after* the terminal event. This falsified the project's core
  immutability invariant.
- **Session scope is enforced on REST as well as WebSocket.** A request body's
  `sessionId` could override the session named in the URL path, so a request
  addressed to one session could drive another — a confused deputy the
  WebSocket transport already blocked. The URL is now authoritative.
- **Resumed snapshots are verified against their own hash chain.** Public
  `session.create` accepted a caller-supplied `resume` snapshot whose embedded
  truth log failed its own chain, and whose `sequence` header disagreed with
  its event count. Both are now checked at the engine boundary shared by the
  CLI and the public transport.
- **Malformed percent-encoding in a session path** returned a 500
  `internal_error`; it now returns a 400 `invalid_params`. Unknown scenario ids
  are likewise reclassified from `internal_error` to `invalid_params`.
- **Oversized request bodies no longer poison keep-alive connections.** The
  body was rejected without draining the stream, desynchronising the socket so
  the *next* request on it failed with `ECONNRESET`.

### Added — M8: Adversarial release candidate

- `pnpm verify:adversarial` — a 91-attack black-box suite
  (`scripts/adversarial/`) that spawns the real server and drives it over real
  HTTP/WebSocket plus the real SDK, MCP, and benchmark packages. Wired as the
  final stage of `pnpm verify`. Truth-leak detection uses an oracle built
  independently of the project's own leak detector, so the scan cannot be
  circular.
- `scripts/adversarial/prove-regressions.mjs` — reverts each fix to its
  inherited form and requires the corresponding regression test to fail,
  restoring source byte-identically afterwards.
- `scripts/adversarial/audit-hygiene.mjs` — gitignore-aware secret and
  stray-artifact scan (0 findings), closing M7's "no secret scanner was run"
  known risk.
- 37 new tests across 5 files: post-completion immutability, transport scope
  and payload handling, resume snapshot validation, weighted routing checked
  against an independently implemented Bellman-Ford over randomized graphs, and
  scenario cycle/probability/reference abuse.
- `03_RELEASE_GATE.md` completed with per-gate evidence, exact commands and
  exit codes, environment, 10 unresolved risks, and an explicit release
  decision.

### Changed — M8

- `README.md` no longer states that Docker is "CI-verified": the required CI
  job exists but has never executed, because this tree has no remote. The
  verification section now also names the adversarial suite.
- Removed `referenceShortestTravelPath` from `packages/simulation/src/graph.ts`
  — it wrapped the very function it would have been used to check, so any
  comparison against it was vacuous. It was unused.

### Known limitations accepted at M8

- `GET /sessions` enumerates live session ids to any local client (P2), and
  there is no ceiling on concurrent sessions (P3). Both are properties of an
  unauthenticated, loopback-only, single-user tool where authentication is an
  explicit v0.1 non-goal; both would be reclassified upward for any shared or
  hosted deployment.
- Not verified in the M8 environment, and not claimed: live Docker build (no
  daemon), fresh-clone proof and CI execution (no git remote), real browser
  E2E (no headless browser in the repository), and an accessibility audit.

### Added — M7: Public repository and release engineering

- Root `README.md` with the product explainer, three-command quickstart,
  architecture diagram, human/agent examples, a real benchmark excerpt
  generated from this codebase, and integrity/limitation terminology.
- `LICENSE` (MIT, matching `package.json`), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff`, this `CHANGELOG.md`.
- `docs/architecture.md`, `docs/protocol.md`, `docs/benchmark.md`,
  `docs/threat-model.md`.
- GitHub issue/PR templates under `.github/`.
- CI workflow (`.github/workflows/ci.yml`): frozen-lockfile install, lint,
  typecheck, full test suite, determinism/invariant suite, package/tarball
  smoke, Command Center smoke flow, release archive + checksum, and a
  required Docker packaging smoke job.
- `Dockerfile` + `docker-compose.yml` for a one-command containerized demo
  (`docker compose up --build`); optional and CI-only — `pnpm verify` never
  depends on Docker.
- `scripts/verify-tarball-smoke.mjs`: packs, extracts, and imports real
  `npm pack` tarballs for two packages with no registry network access,
  proving "built exports only" packaging.
- `scripts/release-archive.mjs`: reproducible source archive plus a
  SHA-256 checksum file under `data/release/`.
- `"files": ["dist"]` on every publishable workspace package, so a packed
  tarball never includes `src/` or dev tooling.

### Added — M6: Scenario suite and authoring experience

- Two new scenarios, `glass-harbor` (hazmat plume, medical-capacity
  cascade, false-attribution reports) and `signal-zero` (comms
  degradation, spoofed telemetry, verification pressure), each distinct
  from `black-river` and each other on dependency graph, observation
  channel, resource tradeoffs, cascade membership, baseline strategy, and
  calibration/verification challenge.
- `docs/scenario-authoring.md` and `templates/SCENARIO_STARTER.json`.
- Deterministic golden receipts per scenario
  (`scenarios/golden-receipts/*.receipt.json`) plus generate/verify scripts.
- `DistrictId` widened to a validated string so new scenario content never
  requires a source-code change.

### Added — M5: SDK, benchmark, and MCP

- `@null-city/sdk`: a typed `PlayerSession` client over the public REST/WS
  surface, with idempotent command retries and full runtime response
  validation.
- `@null-city/benchmark`: a matrix runner with three deterministic,
  non-LLM baseline policies (`noop`, `reactive-greedy`,
  `verification-first`), independently recomputable metrics, and JSON/
  Markdown reports.
- `@null-city/mcp-server`: an MCP adapter over the SDK only, with parity
  tests against direct SDK calls; an optional (non-CI) LLM-policy example.

### Added — M4: Replay Lab and run artifacts

- Finalized `.ncrun`-style run artifact export, receipt verification CLI,
  synchronized truth/player/assessment timelines, run comparison, and a
  clear separation between hash-chain tamper-evidence and optional signing.

### Added — M3: Command Center vertical slice

- `apps/command-center`: a React/Vite browser client driving one full
  human-play loop (start, observe, assess, command, complete, replay)
  against only the public server contract; `pnpm demo` for a one-command
  local launch.

### Added — M2: Scenario compiler and simulation correctness

- Semantic scenario compiler with canonical digests, reference-checked
  weighted routing, corrected per-incident scoring, and the
  `nullcity-scenario validate|compile|inspect` CLI.

### Added — M1: Epistemic boundary and evidence model

- Distinct truth/player event streams and stores; player state
  (`PlayerSessionState`) is rebuilt only from player events; claim/evidence/
  assessment model with provenance and "as of tick" semantics.

### Added — M0: Kernel recovery vertical slice

- Deterministic seeded simulation kernel, snapshot/resume, completed-run
  immutability, and the first verifiable end-to-end CLI run of
  `black-river`.

### Fixed

- See each milestone's ADR under `docs/decisions/` and `docs/audits/` for
  the specific defects repaired from the inherited alpha (`05_KNOWN_FINDINGS.md`).

<!--
This repository has no remote/tag yet (see STATUS.md/EVIDENCE.md for the
current milestone's evidence). Once a hosting remote and first tag exist,
add standard Keep-a-Changelog compare links here instead of this note.
-->

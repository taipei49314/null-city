# Integrity repair — response to the independent v0.1.0 release audit

**Audit decision:** FAIL (2 × P0, 9 × P1, 4 × P2).
**Repair status:** all P0 and P1 findings closed; all four P2 findings closed.
**`pnpm verify`:** exit **0** (transcript below).

This document is the finding-by-finding closure matrix. It exists so a reader
can check each claim against a specific test or command rather than against a
summary. Where a finding was closed by *documenting* a limitation rather than
removing it, the row says so and names the test that pins the documented
behaviour.

## Verification evidence

| Item | Value |
|---|---|
| Command | `pnpm verify` |
| Exit code | **0** |
| Transcript | `data/evidence/2026-08-07-integrity-repair/verify-full.txt` |
| Unit/integration tests | **413 passed / 413 total, 62 files, 0 skipped** |
| Per package | contracts 19, epistemics 3, scenario-schema 28, command-center 76, test-fixtures 9, simulation 153, server 54, sdk 19, mcp-server 15, benchmark 37 |
| Adversarial suite | 91 attacks, 89 defended, **0 vulnerable**, 2 accepted limitations, 0 blocked |
| Release-archive canary | `5 canary file(s) planted, 335 archive entries checked, 3 candidate(s) denied by policy (selection source: allowlist)` |
| Node / pnpm / OS | v24.16.0 / 10.33.0 / Windows 11 (win32 10.0.26200 x64) |
| Working tree is a git repository | **No** — `git status` → `fatal: not a git repository` |

The last row matters for two findings: the release archive falls back to its
allowlist rather than `git ls-files`, and no fresh-clone proof can be produced
here. Both are stated as such below rather than papered over.

## Status vocabulary

- **FIXED** — the behaviour changed and a regression test covers it.
- **FIXED (documented limit)** — the unsafe surface was removed or bounded, and
  the residual limitation is now stated in code, docs, and a test.
- **ACCEPTED** — reproduced, not changed, with a recorded rationale.

## P0 findings

### P0-01 — Caller-controlled snapshot state accepted as authoritative — **FIXED**

Public `POST /sessions` accepted a `resume` snapshot and adopted its world,
score, PRNG state, resource counters, and idempotency keys. Every validation
the engine ran was a self-consistency check, so a forger with the source
recomputed all of them.

**Repair.** Snapshot resume is no longer a public operation.

- `handleRpc` takes an `RpcSurface` (`"public" | "admin"`, default `"public"`);
  `session.create` throws `forbidden` when `resume` is present on the public
  surface (`packages/server/src/rpc.ts`).
- Resume moved to `admin.resume`, reachable only through `handleAdminRpc`.
- REST and WebSocket both pass `"public"` explicitly, and the WebSocket adapter
  additionally refuses any `admin.*` op before dispatch
  (`packages/server/src/http.ts`, `packages/server/src/ws.ts`).
- Rationale, and why "validate harder" and "sign the snapshot" were rejected:
  `docs/decisions/2026-08-07-authority-and-replay-semantics.md` §1.

**Regressions** (`packages/server/test/adversarial-authority.test.ts`, 13 tests):
a genuine snapshot refused over REST; a forged snapshot with a rewritten world
refused and no session created; refusal on the default `handleRpc` surface;
`admin.resume` refused over the public surface and over the player WebSocket;
trusted in-process `admin.resume` still succeeds; `admin.resume` still rejects a
snapshot whose embedded chain is broken. `packages/server/src/cli/verify.ts`
adds `C2.public-resume-refused[<scenario>]` for all three scenarios, and its
resume-equivalence check `C.admin-resume[<scenario>]` now drives the authority
transfer in-process and the play over REST.

### P0-02 — Artifact verification checked hashes but not semantics — **FIXED**

Five mutations (ART-01..ART-05) all verified, because `verifyRunArtifact()`
only proved internal hash consistency and the forger recomputes hashes.

**Repair.**

1. **Terminal ordering.** `SessionHub.publishTruthDelta` emits operational
   public updates *before* `RunCompleted`, so the player stream ends with the
   terminal event (`packages/server/src/hub.ts`).
2. **Structural rules.** `verifyRunArtifact()` requires exactly one
   `ScenarioStarted` as truth event 0, exactly one `ScenarioCompleted` as the
   final truth event, exactly one `SessionStarted` as player event 0, and
   exactly one `RunCompleted` as the final player event.
3. **Identity cross-binding.** `sessionId`, `scenarioId`, `seed` and
   `totalTicks` must agree with both `ScenarioStarted` and `SessionStarted`;
   `finalTick`, `scoreDigest` and `scoreTotal` must agree with
   `ScenarioCompleted` and `RunCompleted`; `finalTick` must equal `totalTicks`.
4. **Command-trace completeness.** `deriveCommandTraceDetailed` reports
   unmatched, duplicated, and orphan command outcomes instead of dropping them.
5. **Payload/tick legality** moved into the chain verifier itself (see P1-04),
   so ART-04 and ART-05 fail the stream, not just the artifact.
6. Baselines regenerated: `scenarios/golden-receipts/*.receipt.json`,
   `data/m4-run-{a,b}.artifact.json` (regenerated inside
   `pnpm verify:artifact-cli`), and `data/m0-black-river.receipt.json`.

**Regressions** (`packages/simulation/test/adversarial-artifact.test.ts`, 10
tests). Each attack **re-chains both event logs and recomputes `artifactHash`**
before verifying, exactly as the audit's reproduction did; a baseline test
proves resealing an honest artifact is a no-op, so the rejections cannot come
from a broken reseal. Covered: ART-01 forged identity, ART-01b forged
`stateDigest` caught by replay, ART-02 removed `RunCompleted`, ART-03 event
appended after `ScenarioCompleted`, ART-04 array payload, ART-05/ART-05b
negative genesis tick (player and truth), a dropped command pair caught only by
replay, and the honest "not verified without a scenario" report.
`packages/server/test/adversarial-immutability.test.ts` covers the terminal
ordering over the live transport.

## P1 findings

### P1-01 — Resume does not preserve player epistemic history — **FIXED (documented limit)**

Public resume is gone, so the only remaining consumer is a trusted operator.
Admin resume replays the snapshot's embedded truth log through a fresh bridge,
which fully restores everything derived from truth (evidence, claims, own-team
state, known routes, public score, resources) and cannot restore
player-originated records (assessments, verification resolutions, command
results), because those never existed in the truth log.

Persisting the player log inside the snapshot was rejected: the snapshot is a
truth-side value owned by the deterministic core, and embedding a player-facing
stream in it inverts the dependency the architecture is built on
(`docs/decisions/2026-08-07-authority-and-replay-semantics.md` §4).

**Regression.** `adversarial-authority.test.ts` →
"restores truth-derived player state but not player-originated history" pins
all of it: same tick, same claim ids, **empty** assessments, a different
`playerLogHash`, and an empty `pendingClaimVerify`. If any of that silently
changes, the test fails and the documentation has to be revisited.

### P1-02 — Release archive could ship ignored secrets and local residue — **FIXED**

`scripts/release-archive.mjs` no longer tars `.` with exclude flags. Selection
moved to `scripts/lib/release-files.mjs`, which applies two independent gates:
a candidate list (`git ls-files -z --cached --exclude-standard` when the tree is
a git checkout, otherwise a walk of an explicit directory/file allowlist), and a
deny list that no candidate may pass — `.env*`, `*.log`, key/cert material,
`.npmrc`/`.netrc`, credentials files, `*.tsbuildinfo`, archives, `data/release`,
and any path under `node_modules`, `dist`, `build`, `coverage`, `.git`, `.data`.
Symlinks are never followed. `tar -T <list>` archives the exact list, and a
`.manifest.txt` ships next to the tarball and checksum.

**Regression.** `pnpm verify:release-archive`
(`scripts/verify-release-archive.mjs`, wired into `pnpm verify`) plants five
canaries — `.env`, `.env.local`, `packages/server/.env`, a stray `.log`, and a
fake `.pem` — builds a **real** archive, lists it with `tar -tzf`, and fails on
any forbidden entry. It also asserts `package.json` *is* present, so a
vacuously empty archive cannot pass. Canaries are removed in a `finally`.
Executed result: `5 canary file(s) planted, 335 archive entries checked, 3
candidate(s) denied by policy (selection source: allowlist)`, exit 0. The denied
count is three rather than five because the two root-level canaries (`.env`,
`.env.local`) are never *candidates* under the allowlist source: the repository
root contributes only files named in `ALLOWED_ROOT_FILES`. The check asserts
both layers separately — canaries absent from the selection *and* absent from
the tarball listing — so neither can mask the other.

One consequence found while writing this check: `docs/audits/…-verify-audit.log`
was also being denied. It is the external auditor's own transcript, and `*.log`
is both gitignored and deny-listed, so it would not have survived a clone. It is
now `…-verify-audit.txt` with identical contents — the same evidence-retention
mistake M8 recorded fixing for its own logs, recurring on an inherited file.

### P1-03 — Docker exposed an unauthenticated control plane beyond loopback — **FIXED**

`docker-compose.yml` publishes `127.0.0.1:8787:8787` and `127.0.0.1:4173:4173`.
The container still binds `0.0.0.0` so the sibling service can reach it over the
compose network; only host publishing is narrowed. The reason is recorded inline
in the compose file.

Not executable here: the Docker daemon is unreachable, so this is a
configuration change reviewed and not a running verification. Recorded as such
in `03_RELEASE_GATE.md` rather than as a passed smoke test.

### P1-04 — Event runtime validation was shape-only — **FIXED**

Kind-specific runtime schemas now run inside the chain verifiers, so an invalid
payload breaks the stream rather than merely failing a downstream consumer:

- `packages/contracts/src/payload-util.ts` — shared primitives, including
  `plainObject` (rejects arrays and `null`) and `tickSchema` (non-negative
  integer, so a negative genesis tick fails);
- `packages/contracts/src/truth-payloads.ts` and `player-payloads.ts` —
  per-kind discriminated schemas;
- wired into `verifyEventStream` / `verifyPlayerEventStream`, which report
  `invalid_payload:<kind>:<path>: <message>`.

**Regressions.** `packages/contracts/test/*` plus ART-04 and ART-05/ART-05b in
`adversarial-artifact.test.ts`. The regeneration of the golden receipts was
itself a consequence: the committed fixtures failed the new validator with
`invalid_payload:ScenarioCompleted:finalScore.eventsHandledPoints: Required`.

### P1-05 — `finalStateDigest()` incomplete and unchecked — **FIXED**

The digest now covers every future-output-affecting value the snapshot carries
(districts, teams with orders/ETAs, routes, resources, incidents, observation
queues, scheduled effects, PRNG state, counters, idempotency keys, the full
score) and is versioned by `STATE_DIGEST_VERSION` (now `2`), so a digest can
never be compared across incompatible definitions.

Completeness alone does not help against a forger, because the digest is a value
inside the artifact. So `verifyRunArtifact(artifact, { scenario })` re-simulates
the run from `seed` + the recorded command trace and requires the regenerated
truth log hash, event count, terminal state digest, score, and final tick to
match. `{ requireReplay: true }` turns "no scenario supplied" into a failure,
and the result always reports `replayChecked` so a weaker check is never
presented as a full one.

**Regressions.** ART-01b (forged digest caught by replay), the dropped-command
test (self-consistent artifact caught only by replay), and the honest
`requireReplay` report — all in `adversarial-artifact.test.ts`.

### P1-06 — Scoring field names and decision-delay semantics — **FIXED**

**Naming.** `ScoreState` now separates measurement from weighting: `score.raw.*`
holds unweighted counts (`incidentsHandled`, `incidentsMissed`,
`chainedIncidents`, `wastedDispatchTicks`, `misadvisoryCostUnits`,
`decisionDelayTicks`, `incidentsWithoutAction`) and the sibling `*Points` fields
hold the weighted contributions actually summed into `total`
(`eventsHandledPoints`, `eventsMissedPoints`, `decisionDelayPoints`, …).

**Semantics.** `updateDecisionDelay` runs on every tick of score recomputation:

- an incident that has never been acted on is charged against the current tick,
  so neglect accrues instead of being free (the inherited code skipped it);
- a penalty is fixed once the incident is acted on and is retained after it
  resolves, so resolving late no longer erases the delay;
- the "effective" milestone from `docs/scoring.md` is now recorded: the first
  tick at which an applicable team is working the incident's district counts as
  the response, so a team pre-positioned *before* the incident started is
  credited instead of being scored as "never acted on".

`docs/scoring.md` was rewritten to match, including an explicit raw-vs-weighted
section and the note that `decisionDelayTicks` is a summed pre-weighted penalty,
not a per-incident tick count.

**Regressions.** `packages/simulation/test/scoring-fixtures.test.ts` (7 tests),
including "separates raw measurements from weighted point contributions" (which
asserts `eventsHandledPoints === 10 × raw.incidentsHandled`) and "charges
decision delay for an incident that is never acted on" (which fails outright on
the inherited skip). Golden receipts and benchmark baselines were regenerated;
scores are unchanged for the three golden plays (49.37 / 44.51 / 39.38).

### P1-07 — Verification targeting mutated before command acceptance — **FIXED**

`pendingClaimVerify` and `bridge.targetClaim()` are now applied only after
`engine.submitCommand()` returns, via `applyVerificationTargeting`
(`packages/server/src/rpc.ts`). A rejected command clears any prior binding. An
accepted command binds to the team's live `orderId` **and** the accepted
`commandId`; if there is no live order, no binding is invented.
`SessionHub.mirrorOperationalPublicState` resolves a pending verification only
when the still-active order matches the one recorded in the binding, instead of
resolving whenever that team happens to be `working`.

**Regressions.** `adversarial-authority.test.ts` → "does not bind a claim when
the verification command is rejected" and "binds a claim to the accepted order
and clears it when a later request is rejected" (which also asserts the recorded
`orderId` and `commandId`).

### P1-08 — `session.advance` under-reported the terminal tick — **FIXED**

`step()` returns "another tick is possible", not "a tick ran", so counting loop
iterations lost the terminal tick. `sessionAdvance` now measures the delta
against the clock: `engine.currentTick - tickBefore`.

**Regressions.** `adversarial-authority.test.ts` → advancing black-river by
`totalTicks` from tick 0 reports `advanced: 540` (the inherited code reported
539); advancing an already-complete run reports `0`; a bounded advance of 30
reports `30`.

### P1-09 — Truth import boundary was convention-based — **FIXED**

`@null-city/contracts` is split into separately resolvable entry points:

- `.` / `./public` — `packages/contracts/src/index.ts`, player-safe only;
- `./truth` — `packages/contracts/src/truth-entry.ts`, re-exports the public
  surface plus `eventHash`, `verifyEventStream`, `verifyEventChain`,
  `validateTruthEventPayload`, and the truth types.

Truth-only world-state interfaces moved out of `types.ts` into `truth-state.ts`.
`packages/simulation` and `packages/server` import from
`@null-city/contracts/truth`; player-facing packages cannot reach truth through
the barrel any more.

**Regressions.** `packages/contracts/test/entrypoints.test.ts` asserts the
public entry exports no truth-only symbol and that `./truth` does expose truth
verification. The forbidden-import pattern list in each of the sdk,
command-center, mcp-server, and benchmark test suites now rejects any
`@null-city/contracts/truth` specifier.
`scripts/package-smoke.mjs` checks the same separation
against the **built** `dist/`, so a build that re-exported truth from the public
entry would fail `pnpm verify`.

## P2 findings

### P2-01 — Compiled scenario objects were mutable shared references — **FIXED**

`compileScenario` deep-freezes the compiled value before returning it, so the
`digest` cannot go stale under an in-process write. Regression:
`packages/simulation/test/scenario-validation.test.ts` → "returns a deep-frozen
compiled scenario", which also asserts a nested write throws `TypeError`. Two
existing tests that built invalid variants by writing through the compiled
object now clone first.

### P2-02 — WebSocket payload/backpressure bounds missing — **FIXED**

`packages/server/src/ws.ts` sets a protocol-size ceiling
(`MAX_WS_PAYLOAD_BYTES`) on the `WebSocketServer` and applies a slow-client
policy on send using `bufferedAmount` against `MAX_WS_BUFFERED_BYTES`.

While adding the admin gate here, a latent crash was found and fixed: `op` is
attacker-controlled and need not be a string, and `message.op?.startsWith(...)`
threw out of the `message` handler and killed the process. The adversarial suite
caught it. Regression: `packages/server/test/ws.test.ts` → "survives a
non-string rpc op instead of crashing the process", which also asserts the
socket still works afterwards.

### P2-03 — Route reopen metadata stale — **FIXED**

`SimulationEngine.setRouteClosed` clears `closedAtTick`/`closedBy` on reopen and
appends the closed/reopened pair to an explicit `closureHistory` array, so
current state and history are separate fields with separate meanings.

### P2-04 — "New scenario is pure JSON with no source edit" was false — **FIXED (claim narrowed)**

The claim is true for the CLI, server, SDK, MCP adapter, and benchmark runner,
and false for the browser Command Center, whose launch picker and map render
from a hand-authored topology in `apps/command-center/src/topology/`. `README.md`,
`CONTRIBUTING.md`, and `docs/scenario-authoring.md` now say exactly that, and
name both source additions a new scenario needs (the test-fixtures registry and
the Command Center topology). `docs/scenario-authoring.md` previously claimed
the Command Center "reads scenario content itself, not a hardcoded id"; that
sentence was wrong and is gone.

## Carried forward — not closed by this repair

These are unchanged from `03_RELEASE_GATE.md` and are not claimed as fixed.

1. **No fresh-clone proof.** This tree is not a git repository. Install/start is
   covered by `verify:package-smoke` and `verify:tarball-smoke`.
2. **No live Docker verification.** The daemon is unreachable, so the loopback
   bind (P1-03) is a reviewed configuration change, not a running smoke test.
3. **No real browser E2E**, and **no accessibility audit**.
4. **CI has never executed** — there is no remote.
5. **Tamper evidence is not authenticity.** Cross-binding and replay raise the
   cost of forgery; they do not establish provenance, and no trusted root or
   signing key ships. Artifact verification without a compiled scenario is
   explicitly weaker, and now reports that fact via `replayChecked`.
6. **Two accepted adversarial limitations** (`session.list` enumeration, no
   concurrent-session ceiling) remain accepted with the rationale already
   recorded in `docs/threat-model.md`.

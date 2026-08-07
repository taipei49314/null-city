# NullCity Public Release Gate

Fill every row with `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. Include the exact command, exit code, environment, and artifact/log path. Do not replace evidence with prose.

> **Superseded by the external audit of 2026-08-07.** An independent reviewer
> audited the v0.1.0 candidate *after* M8 declared "READY TO TAG — conditional"
> and returned **FAIL**, with two P0 findings against claims this gate had
> already marked `PASS`. All 15 audit findings are now closed
> (`docs/audits/2026-08-07-integrity-repair.md`) and `pnpm verify` exits 0, but
> **the decision below is now `NOT READY TO TAG`.** The M8 rows are retained
> unedited beneath the repair section so the two assessments can be compared;
> where the audit contradicted an M8 row, the repair section is authoritative.
>
> Rows are filled from executed commands only. Where a gate could not be
> executed in this environment it is marked `BLOCKED` with the reason — not
> `PASS`.

## Post-audit repair status (2026-08-07, authoritative)

| Item | Value |
|---|---|
| External audit decision | **FAIL** — 2×P0, 9×P1, 4×P2 |
| Findings closed | **15 of 15** (2 of them by bounding + documenting the residual limitation) |
| `pnpm verify` | exit **0** |
| Tests | **413 passed / 413, 62 files, 0 skipped** |
| Adversarial suite | 91 attacks, 0 vulnerable, 2 accepted limitations |
| Release-archive canary | `5 canary file(s) planted, 335 archive entries checked, 3 candidate(s) denied by policy` — no canary reached the tarball |
| Transcript | `data/evidence/2026-08-07-integrity-repair/verify-full.txt` |
| Closure matrix | `docs/audits/2026-08-07-integrity-repair.md` |
| ADR | `docs/decisions/2026-08-07-authority-and-replay-semantics.md` |

### Gates whose M8 status the audit falsified, and their current status

| Gate | M8 said | Audit found | Now |
|---|---|---|---|
| A / Completed state immutable, one terminal event | PASS | The shipped baseline artifact's player log ended in `OwnTeamUpdated`, and the verifier accepted a removed `RunCompleted` and an event appended after `ScenarioCompleted` | PASS — ordering fixed in `SessionHub.publishTruthDelta`; singleton/terminal rules enforced in `verifyRunArtifact`; ART-02/ART-03 rejected by `packages/simulation/test/adversarial-artifact.test.ts` |
| B / Tamper rejection | PASS | Public `session.create` still adopted a caller-supplied snapshot's world, score, PRNG state and counters. M8 had hardened the snapshot's *internal consistency*, which a forger recomputes | PASS — public resume removed entirely; `admin.resume` is in-process only; 13 regressions in `packages/server/test/adversarial-authority.test.ts` and a `C2.public-resume-refused` check per scenario in `pnpm verify:server` |
| B / Command-trace re-simulation | PASS | `verifyRunArtifact()` never recomputed terminal state, and `finalStateDigest()` omitted resources, orders, observation queues, PRNG state and counters | PASS — digest is complete and versioned; `verifyRunArtifact(artifact, { scenario })` re-simulates and compares; `replayChecked` is reported so an unverified digest is never presented as verified |
| C / Scoring units correct | PASS | `eventsHandled` held `10 × count`, `decisionDelayTicks` held penalty points, and unanswered incidents were skipped by the delay penalty | PASS — raw vs weighted split, delay charged against the current tick for unanswered incidents, `docs/scoring.md` rewritten to match |
| D / Runtime request validation | PASS | Chain verifiers accepted any non-null object as a payload, including arrays, and a negative genesis tick | PASS — per-kind runtime schemas inside both verifiers; ART-04/ART-05 rejected |
| D / Session scope enforced | PASS | `pendingClaimVerify` was written before the engine saw the command and resolved off any `working` state | PASS — bound to the accepted order and command id, cleared on rejection |
| G / README claims match code | PASS (2 corrections) | "A new scenario ships as pure JSON" is false for the Command Center, which hardcodes three topology modules | PASS — claim narrowed in `README.md`, `CONTRIBUTING.md`, and `docs/scenario-authoring.md`, which had also asserted the opposite outright |
| G / Repository clean, release artifact | PASS | `release-archive.mjs` shipped a canary `.env` and two local `.log` files into the tarball | PASS — allowlist selection with independent deny rules, verified by `pnpm verify:release-archive` on every run |

### Newly added verification

| Command | Purpose | Result |
|---|---|---|
| `pnpm verify:release-archive` | Plants `.env`, `.env.local`, `packages/server/.env`, a stray `.log`, and a fake `.pem`; builds a real archive; lists every entry | exit 0 — 335 entries checked, no canary present, `package.json` still present |
| `pnpm verify:server` → `C2.public-resume-refused[*]` | Public `POST /sessions` with a genuine snapshot | exit 0 — `403 forbidden` for all three scenarios |
| `packages/simulation/test/adversarial-artifact.test.ts` | ART-01..ART-05 with full re-chaining and `artifactHash` recomputation | 10/10 pass |
| `packages/server/test/adversarial-authority.test.ts` | P0-01, P1-01, P1-07, P1-08 | 13/13 pass |
| `packages/contracts/test/entrypoints.test.ts` + `scripts/package-smoke.mjs` | Public entry exports no truth symbol, in source **and** in the built `dist/` | pass / exit 0 |

### Still not discharged (unchanged by this repair)

1. **Fresh-clone proof** — this tree is not a git repository. Because of that,
   the release archive also runs on its allowlist path rather than
   `git ls-files`; both selection paths share the same deny rules, but only the
   allowlist path has been executed here.
2. **Live Docker smoke** — the daemon is unreachable, so the P1-03 loopback bind
   is a reviewed configuration change, not a running verification.
3. **CI has never executed** — there is no remote.
4. **No real browser E2E** and **no accessibility audit**.
5. **Tamper evidence is not authenticity.** Cross-binding and replay raise the
   cost of forging an artifact; they do not establish provenance. No trusted
   root or signing key ships.

### Decision after the audit repair

**NOT READY TO TAG.** No P0 or P1 finding is open and `pnpm verify` is green,
but items 1–3 above are exactly the gaps that let the previous "READY TO TAG —
conditional" stand while two P0 defects were live. Tagging should wait until a
real remote exists and the CI `verify` and `docker-smoke` jobs have passed on a
runner from the tagged commit, and until an independent reviewer re-runs the
audit's reproductions against this tree.

### M9 note (2026-08-07)

Product-depth work landed (zh-TW UI, Mirror District, 戰後簡報, `verify:audit-repro`,
git init). The automated audit reproductions now pass in-tree. Release decision
remains **NOT READY TO TAG** until Docker/CI/independent review close.

---

## M8 gate (retained for comparison; superseded above where they conflict)

## Environment

| Item | Value |
|---|---|
| OS | Microsoft Windows 11 Pro (win32 10.0.26200, x64) |
| Node | v24.16.0 (repository `engines.node` is `>=20`; CI pins 20) |
| pnpm | 10.33.0 (matches `packageManager`) |
| Docker | CLI 29.6.2 present, **daemon not reachable** (`docker info` exit 1) |
| Git | 2.49.0 installed, but this working tree is **not a git repository** (`git status` → `fatal: not a git repository`) |
| Package version | `null-city@0.1.0` |
| Date of run | 2026-08-07 |

Two environment facts constrain this gate and are carried into "Unresolved
risks": there is no Docker daemon, and there is no git repository, so no
`docker build` and no `git clone` can be executed here.

## Headline result (M8 — SUPERSEDED)

> The `pnpm verify` figure below is the M8 count. Current: exit 0, 413 tests /
> 62 files. The release decision row is superseded; see the top of this file.

| Metric | Value |
|---|---|
| Adversarial attacks executed | 91 |
| Findings before fixes | 16 vulnerable — **P0 5, P1 7, P2 2, P3 2** |
| Findings after fixes | 0 vulnerable, 2 reproduced-and-accepted (1×P2, 1×P3) |
| P0/P1 fixed | **12 of 12** |
| Regression tests proven to fail on the inherited behaviour | 5 of 5 |
| `pnpm verify` | exit **0** — 382 tests / 59 files, all passing |
| Release decision | ~~**READY TO TAG**~~ — falsified by the 2026-08-07 external audit; current decision is **NOT READY TO TAG** |

Pre-fix baseline log: `data/evidence/m8-adversarial/prefix-baseline.txt`
Post-fix report: `data/evidence/m8-adversarial/report.md` / `report.json`
Full verify transcript: `data/evidence/m8-adversarial/verify-full.txt`
Regression proof: `data/evidence/m8-adversarial/regression-proof.txt`

## A. Product integrity

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| No active-run truth leak | Black-box REST/WS/UI/SDK/MCP tests over all endpoints and event kinds | PASS | 23 attacks in A1 + A7 (`report.md` A1-00…A1-11, A7-01…A7-10) scan every REST route, WS broadcast, SDK view, and MCP tool result against an **independent truth oracle** built from the engine's internal incident/attribute values (`scripts/adversarial/lib.mjs`, `truthOracle`). A1-00 is a meta-check proving the oracle holds real secrets, so a clean scan cannot be vacuous. 0 leaks. |
| Player projection independence | Test proving player state can be rebuilt from player events alone | PASS | Pre-existing `packages/epistemics` + `packages/server` projection tests, re-run green in `verify-full.txt`. A1 additionally confirms no truth-derived field appears in any public payload. |
| Human/agent parity | Contract snapshots comparing browser, SDK, benchmark, MCP payloads | PASS | A7-02 diffs the SDK's `getState()` against raw REST `/state` (no extra field); A7-03 proves no adapter reaches a privileged snapshot op over the network; A7-05/06 prove the MCP package exports and tool names contain no privileged surface; A7-09 hands a **hostile benchmark policy** the run and confirms it never receives truth. |
| Completed state immutable | Parameterized test for every command/assessment/admin mutation | PASS | **Was P0 — fixed this milestone.** A3 (12 attacks, A3-00…A3-11) covers post-completion commands, assessments, advance, resume, delete/recreate, and admin ops. Regression: `packages/server/test/adversarial-immutability.test.ts` (4 tests). |
| One terminal event/receipt | Event invariant test and artifact inspection | PASS | A3-07 asserts exactly one terminal player event survives every mutation attempt, A3-08 that nothing is appended after it, and A3-09/A3-10 that the exported artifact stays byte-identical with terminal score and tick intact. A4-25 catches a fully rehashed artifact by cross-checking `scoreTotal` against the terminal payload. |
| Honest integrity terminology | Docs distinguish hash chain, trusted root, and signature | PASS | `README.md` §"Integrity terminology and limitations" and `docs/protocol.md#integrity-terminology` state tamper-evidence ≠ authenticity and that no signing key/trusted root ships. Reviewed against A4-22 (declared hash swap) and A4-25 (full rehash), which confirm the honest framing: a self-consistent forged chain is *not* detectable without a trusted root — documented, not hidden. |

## B. Determinism and replay

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| Same inputs, byte-identical logs | Multiple seeds/scenarios and clean-process reruns | PASS | `pnpm verify:determinism` (in `pnpm verify`, exit 0) — same-seed determinism, different-seed divergence, forbidden-randomness scan. |
| Arbitrary snapshot/resume equivalence | Property/randomized tests before/during/after incidents and chains | PASS | Pre-existing `packages/simulation` snapshot/resume equivalence suites, green in `verify-full.txt` (140 simulation tests). |
| Snapshot immutability | Byte identity after original engine continues | PASS | A4-01 takes a snapshot, continues the original engine, and confirms the snapshot did not move; A4-04 confirms a resumed engine does not alias the caller's snapshot object graph. Backed by the pre-existing simulation snapshot-detachment tests. |
| Scenario digest binding | Mismatch rejection before engine creation | PASS | A4-05…A4-09 (session, seed, scenario, protocol-version mismatch, and a forged scenario digest) all rejected before engine construction; A4-10/A4-11 additionally reject a header tick that disagrees with the world and a snapshot missing a scoring-relevant field. |
| Command-trace re-simulation | Terminal hashes and state digests match | PASS | `pnpm verify:golden-receipts` and `pnpm verify:replay-lab`, exit 0 in `verify-full.txt`. |
| Tamper rejection | Payload, sequence, tick, session, stream, anchor, terminal mutations | PASS | **Was P1 — fixed this milestone.** A4 (25 attacks) covers forged anchors, tick rollback, sequence gaps, stream/session swap, terminal substitution and rehash. The gap was that public `session.create` accepted a `resume` snapshot whose truth log failed its own hash chain (A4-13). Fixed at the engine boundary; regression `packages/simulation/test/adversarial-resume.test.ts` (7 tests). |

## C. Simulation correctness

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| Weighted routes correct | Reference Dijkstra and randomized graphs | PASS | `packages/simulation/test/adversarial-graph.test.ts` (6 tests) checks `shortestTravelPath` against an **independently implemented Bellman-Ford** reference over randomized graphs, plus disconnected, blocked-route, and tie cases. Also removed `referenceShortestTravelPath`, which was a wrapper around the implementation under test and would have made any such comparison circular. |
| Scenario semantics correct | Duplicate/reference/cycle/probability/resource negative tests | PASS | `packages/scenario-schema/test/adversarial-scenario.test.ts` (13 tests): chain-trigger self-cycle, three-incident ring, unknown incident reference, corruption probabilities summing to exactly 1 / above 1 / outside [0,1], self-loop route, unknown district in route, non-positive travel time, oversized and non-object scenario input. Plus `pnpm verify:scenarios`, exit 0. |
| Incident lifecycle correct | No invalid reactivation; relative/absolute observation consistency | PASS | Pre-existing simulation lifecycle/observation suites, green in `verify-full.txt`. Not extended this milestone — no counterexample found. |
| Scoring units correct | Per-incident timeline fixtures and independent recomputation | PASS | `packages/benchmark` recomputes every metric from the hash-chain-verified public log only (37 tests); A7-10 confirms the benchmark independently verifies the chain rather than trusting the server. Benchmark table in `README.md` matches `data/benchmark-smoke/report.md` verbatim (checked cell by cell; deltas +45.17 and +20.27 recomputed and correct). |
| Duration edges correct | Boundary tests for generators, communication priority, route state | PASS | Pre-existing simulation boundary suites, green. A6-03 additionally pins the 540-tick advance cap over the public transport. |
| Resource exhaustion safe | Bounded arrays, ticks, effects, requests, payloads, advance limits | PASS (1 accepted limitation) | A5 (12 attacks) + A6 (11 attacks): oversized bodies, deep nesting, huge strings, NaN/Infinity ticks, prototype pollution, 25 concurrent WS subscribers, 200-message bursts, out-of-range pagination, MCP limits. One accepted limitation: **A6-07**, no ceiling on concurrent sessions (P3, see "Accepted limitations"). |

## D. Security and transport

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| Session scope enforced | Cross-session REST/WS negative tests | PASS (1 accepted limitation) | **Was P1 — fixed this milestone.** A2 (8 attacks). REST let a request body's `sessionId` override the URL path, so `POST /sessions/A/command` with `{"sessionId":"B"}` drove session B — a confused deputy the WS transport already blocked. Fixed by making the URL authoritative; regression `packages/server/test/adversarial-transport.test.ts`. Accepted limitation: **A2-05**, `session.list` enumerates other sessions (P2, see below). |
| Runtime request validation | malformed JSON, null, unknown fields, oversized payloads | PASS | **Was P1 — fixed this milestone.** A5 (12 attacks). Malformed percent-encoding in the path (`/sessions/%E0%A4%A/state`) threw `URIError` and surfaced as a 500; now a 400 `invalid_params`. Unknown scenario ids returned `internal_error`; now `invalid_params`. No prototype pollution, no crash, no 5xx across the whole set. |
| Error boundaries | subscriber, upgrade, message, and handler failures isolated | PASS | A6-01/A6-02 throw from a WS subscriber and confirm neither the sibling session nor the server is affected; A6-11 deletes a session with a live subscriber attached; A6-05/A6-10 stress subscriber count and message volume. |
| No secret leakage | secret scanner and manual config review | PASS | `node scripts/adversarial/audit-hygiene.mjs`, exit 0 — 348 files scanned against 6 credential patterns (assigned credentials, AWS key ids, private-key blocks, GitHub/Slack/OpenAI tokens): **0 findings**. This closes M7's "no secret scanner was run" known risk. |
| Dependency review | lockfile audit plus documented accepted findings | PASS (inherited, unchanged) | `pnpm audit --prod` — 3 moderate `react-router`/`react-router-dom` advisories, accepted with rationale in `docs/threat-model.md` §9. Unchanged this milestone; no new dependency was added. |
| Threat model current | maps claims, assets, trust boundaries, attacks, mitigations | PASS | `docs/threat-model.md` updated with the two accepted limitations and the five fixed defects. |

## E. Usability

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| One-command demo | fresh clone → install → `pnpm demo` → usable browser flow | **BLOCKED (partial)** | The clone half cannot be executed: this tree is not a git repository. The install/start half **is** covered by executed commands — `pnpm verify:package-smoke` and `pnpm verify:tarball-smoke` do a real `npm pack` → extract → import → start from a temporary directory with no registry access, and `pnpm verify:command-center` builds and serves the UI. A true fresh-clone transcript is an unresolved risk, not a pass. |
| No API key required | default human and baseline-policy demos | PASS | `pnpm verify` (whole chain, exit 0) runs the server, SDK, benchmark, and MCP quickstarts with no key and no network beyond install. A7-09 runs a full benchmark policy headlessly. |
| Complete scenario flow | start, observe, assess, command, complete, replay, export | PASS | Exercised end to end by the adversarial harness itself: every A3/A4 attack first drives a real session to `completed` through the public REST/WS API and exports the artifact. Also `pnpm verify:player-cli`, `verify:artifact-cli`, `verify:replay-lab`, all exit 0. |
| Accessible core controls | keyboard path, labels, focus, contrast, reduced motion | **NOT_RUN** | No accessibility audit was performed in this milestone and none is claimed. `apps/command-center` has 76 passing component tests, but they do not constitute an a11y audit. Carried as an unresolved risk. |
| Actual documentation media | screenshots/GIF captured from release candidate | PASS (with caveat) | Both README screenshots exist and load (`data/evidence/m3-command-center-launch.png`, 214,739 bytes; `…-session.png`, 229,581 bytes). Caveat: they were captured at **M3**, not from this candidate. The UI has not changed materially since, but they are not regenerated-from-this-commit media. |
| Actionable errors | invalid scenario, failed server, bad artifact, unavailable port | PASS | Improved this milestone: unknown scenario and malformed path now return `invalid_params` with the offending value echoed, instead of `internal_error`/500 (A1-08b, A5-08, A5-11). A4's 25 tamper attacks each assert a specific, non-generic rejection reason. |

## F. Engineering quality

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| Lint | exact command and exit code | PASS | `pnpm lint` — exit 0 (chained inside `pnpm verify`, `verify-full.txt`). |
| Typecheck | exact command and exit code | PASS | `pnpm typecheck` — exit 0. TypeScript strict mode remains enabled. |
| Unit tests | exact command and result counts | PASS | `pnpm -r test` — exit 0. **382 passed / 382 total, 59 files**, 0 skipped: contracts 15, scenario-schema 28, epistemics 3, command-center 76, test-fixtures 9, simulation 140, server 40, sdk 19, mcp-server 15, benchmark 37. (M7 baseline was 345; +37 added this milestone.) |
| Integration tests | exact command and result counts | PASS | `verify:server`, `verify:sdk`, `verify:benchmark`, `verify:mcp`, `verify:command-center`, `verify:receipt-slice`, `verify:golden-receipts` — all exit 0 in the same chain. Plus `pnpm verify:adversarial`: 91 attacks against a real spawned server, exit 0. |
| Browser E2E | exact command, browser, artifacts | **BLOCKED** | `pnpm command-center:e2e` exists and passes, but it is an HTTP/preview-bundle smoke test, **not** a real browser. No headless browser (Playwright/Puppeteer) is installed or run. Reported as BLOCKED rather than PASS; the README/CI wording says "smoke flow", not "browser test". |
| Build | all packages/apps build from clean state | PASS | `pnpm build` — exit 0, all 9 packages + Command Center. |
| Package smoke | pack/install/import/start from temporary directory | PASS | `pnpm verify:package-smoke` and `pnpm verify:tarball-smoke` — exit 0, real `npm pack` → extract → import, no leaked `src/`, no registry network access. |
| Docker smoke | build, health, scenario run, shutdown | **BLOCKED** | Docker CLI 29.6.2 is installed but the daemon is unreachable (`docker info` → exit 1, `dockerDesktopLinuxEngine` pipe missing). `scripts/verify-docker-smoke.mjs` was not run. The CI `docker-smoke` job is configured and required, but CI has never executed (no remote). Unresolved risk. |
| No skipped critical tests | explicit scan and review of skip/only/todo | PASS | Scan for `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(` across all test globs: **0 matches**. No `continue-on-error` on a required CI job (the only one is the explicitly non-required `pnpm audit` step). |
| Full diff inspected | changed-file list and reviewer note | PASS | Changed-file list in `STATUS.md` → "Changed files (M8)". Reviewer note: 5 production files changed, all narrow guards at existing boundaries; no refactor, no new dependency, no new runtime surface. Verified by `prove-regressions.mjs` that source restoration after patch testing is byte-identical. |

## G. Open-source release hygiene

| Gate | Required evidence | Status | Evidence |
|---|---|---|---|
| README claims match code | reviewer comparison | PASS (2 corrections made) | Every checkable claim verified: 9 MCP tools (9 `registerTool` calls), 3 baseline policies, 3 scenarios, `"files": ["dist"]` on 9 packages, `forbidden-imports` test in all 4 named packages (+server), SDK example file exists, all 13 doc links resolve, Dockerfile pins `node:20` and compose exposes 8787/4173 exactly as documented, `engines.node >=20` and `pnpm@10.33.0` consistent across `package.json`/CI/Dockerfile, benchmark table matches `data/benchmark-smoke/report.md` verbatim with deltas recomputed. **Corrected:** (1) "Docker is CI-verified" → the job exists but has never run, now stated as such; (2) the verification paragraph now names the adversarial suite. |
| LICENSE exists and matches package metadata | file/package check | PASS | `LICENSE` (MIT) and root `package.json` `"license": "MIT"`. |
| CONTRIBUTING / SECURITY / CoC | files present and accurate | PASS | All present; re-read this milestone; placeholder GitHub URLs are explicitly flagged as placeholders. |
| CHANGELOG / release notes | versioned changes and known limits | PASS | `CHANGELOG.md` updated with the M8 entry (5 fixed defects, 2 accepted limitations). |
| CITATION.cff valid | validator output | PASS (subset) | `audit-hygiene.mjs` confirms the CFF 1.2.0 required-field subset (`cff-version`, `message`, `title`, `authors`) is present and the file parses as YAML-shaped text. Honest caveat: this is **not** a full `cffconvert` schema validation — that tool is a Python dependency this repository does not carry. |
| Repository clean | no archives, local logs, temp snapshots, secrets, node_modules | PASS | `audit-hygiene.mjs`, exit 0: **0 stray artifacts that would ship in a clone**. The 5 local artifacts present (release tarball, three `.log` files) are all matched by `.gitignore` and absent from a clone; the audit is gitignore-aware and reports the two categories separately. Fixed this milestone: M8 evidence was initially written to `.log` paths that `.gitignore` excludes, so it would not have survived a clone — evidence is now `.txt`/`.md`/`.json` under `data/evidence/m8-adversarial/`. |
| Release artifact checksums | generated and verified | PASS (inherited) | `data/release/null-city-v0.1.0.tar.gz` + `.sha256` generated by `pnpm release:archive` at M7. Not regenerated this milestone; it must be regenerated at tag time from the tagged commit. |
| Fresh-clone proof | isolated directory or CI job with transcript | **BLOCKED** | No git repository exists in this working tree, so no clone can be made and the CI checkout job has never run. Nearest executed evidence is the tarball smoke (pack → extract → import → start in a temp directory, exit 0), which covers install-and-start but not clone-and-install. Unresolved risk; must be discharged by the owner after the first push. |

## Fixed defects (all found by the adversarial suite this milestone)

| ID | Sev | Defect | Fix | Regression test (proven to fail on inherited behaviour) |
|---|---|---|---|---|
| D1 | **P0** | A completed run was not immutable: a post-completion command still appended a `CommandResult` player event, moving `playerLogHash`, the player event count, and therefore the exported artifact hash after the terminal event. Falsifies the core invariant and gate A. | `packages/server/src/rpc.ts` answers post-completion commands before the verification queue, engine, and bridge are touched. | `packages/server/test/adversarial-immutability.test.ts` — 4/4 fail when reverted. |
| D2 | **P1** | Confused deputy: the REST body's `sessionId` overrode the URL path, so a request addressed to session A could drive session B. WS already blocked this. | `packages/server/src/http.ts` spreads the body first and sets `sessionId` last, making the URL authoritative. | `packages/server/test/adversarial-transport.test.ts` — 3 fail when reverted. |
| D3 | **P1** | Malformed percent-encoding in a session path threw `URIError`, surfacing as a 500 `internal_error` instead of a client error. | `http.ts` catches the decode failure and returns 400 `invalid_params`. | `adversarial-transport.test.ts` — 1 fails when reverted. |
| D4 | **P1** | Public `session.create` accepted a caller-supplied `resume` snapshot whose embedded truth log failed its own hash chain, and whose `sequence` header disagreed with the event count. | `packages/simulation/src/engine.ts` `validateResumeBinding` now runs `verifyEventStream` and a sequence-counter check at the boundary every caller shares. | `packages/simulation/test/adversarial-resume.test.ts` — 5 fail when reverted. |
| D5 | P2 | An oversized request body was rejected without draining the stream, desynchronising the keep-alive connection: the *next* request on that socket died with `ECONNRESET`. | `http.ts` drains the remainder up to a bounded `MAX_DRAIN_BYTES` and returns a clean 413, closing the socket only when the sender exceeds the drain cap. | `adversarial-transport.test.ts` — 1 fails when reverted. |

Also fixed, no separate regression needed (covered by A1-08b and A5-08/A5-11 in
the suite): unknown scenario ids and malformed scenario names returned
`internal_error` instead of `invalid_params` (P3, error-classification quality).

Verification that these tests are not vacuous:
`node scripts/adversarial/prove-regressions.mjs` → exit 0, **5/5 REGRESSION
PROVEN**, source restoration byte-identical
(`data/evidence/m8-adversarial/regression-proof.txt`).

## Accepted limitations (reproduced, not fixed)

These are real, reproduced behaviours. They are recorded as accepted product
decisions with rationale, not as passes, and the suite reports them as
`ACCEPTED` — a distinct status from both `DEFENDED` and `VULNERABLE`, so they
can never be read as "nothing found", and so the entry flips back to
`DEFENDED` automatically if the behaviour ever changes.

| ID | Sev | Behaviour | Why accepted |
|---|---|---|---|
| A2-05 | P2 | `session.list` / `GET /sessions` enumerates every live session id to any local client. | The server is unauthenticated and loopback-only by design; any process that can call this endpoint can already call every other one, so session ids are identifiers, not capabilities. Authentication is an explicit v0.1 non-goal (`00_NORTH_STAR.md`). Would become P1 the moment a shared or hosted deployment is in scope. |
| A6-07 | P3 | No ceiling on concurrent sessions; 60 were created with no cap, each holding a full engine and event log. | Only reachable by a process already on the loopback interface, which can exhaust memory more simply. A cap would break the benchmark matrix, which legitimately opens many sessions. Revisit for any shared deployment. |

## Unresolved risks

Carried forward honestly; none is recorded as a pass.

1. **No fresh-clone proof.** This tree is not a git repository. Install/start
   is covered by the tarball smoke; clone-and-install is not. Owner must
   discharge this after the first push.
2. **No live Docker verification.** Daemon unreachable. The image, compose
   file, and smoke script are reviewed and schema-valid only. The required CI
   `docker-smoke` job has never executed.
3. **No real browser E2E.** `command-center:e2e` is an HTTP/preview smoke
   test. No headless browser automation exists in the repository.
4. **No accessibility audit** (gate E row 4) was performed.
5. **CI has never run.** The workflow is configured and reviewed; there is no
   run history because there is no remote.
6. **Screenshots date from M3**, not from this candidate. They are accurate to
   the current UI on review, but not regenerated from this commit.
7. **CITATION.cff validated against a required-field subset**, not the full
   CFF 1.2.0 schema.
8. **Tamper-evidence is not authenticity.** A self-consistent forged chain
   (recomputed with the real hash function) is accepted by design, because no
   trusted root or signing key ships. A4-22 and A4-25 confirm the boundary sits
   exactly where the README says it does. This is a documented limitation, not
   a defect.
9. **Inherited dependency advisories**: 3 moderate `react-router` advisories,
   accepted at M7, unchanged.
10. **Node version drift**: verified on Node 24 locally; CI and the Dockerfile
    pin Node 20. `engines.node` is `>=20`, so both are in contract, but the
    exact CI matrix has not been executed here.

## Release decision (M8 — SUPERSEDED)

> This decision was falsified by the external audit of 2026-08-07: two P0
> defects were open when it was written. The binding decision is "Decision
> after the audit repair" at the top of this file.

A release candidate is rejected when:

- any P0/P1 issue against a public claim is open;
- any required gate is `FAIL`;
- a required gate is `NOT_RUN` without an explicit release blocker;
- evidence was generated from a modified audit shim rather than production dependencies;
- screenshots, benchmark numbers, or test counts cannot be reproduced from the tagged commit.

**Decision: READY TO TAG — conditional.** The owner tags; this milestone does
not.

Against the rejection criteria:

- **No open P0/P1.** 12 of 12 found P0/P1 issues are fixed, each with a
  regression test empirically proven to fail on the inherited behaviour. The
  two remaining findings are P2/P3 and are accepted design limitations of an
  unauthenticated local-first tool, documented in the threat model.
- **No required gate is `FAIL`.** Every gate is `PASS` or `BLOCKED`.
- **Four gates are `BLOCKED`/`NOT_RUN` with explicit blockers**: fresh-clone
  proof and CI execution (no git remote exists), Docker smoke (no daemon), real
  browser E2E (not implemented), accessibility audit (not performed). The first
  three are environment blockers, not defects; the fourth is an honest scope
  gap. None of them falsifies a claim the README actually makes — the README
  now states the Docker job has not yet run, and says "smoke flow" rather than
  "browser test".
- **Evidence is from production dependencies.** The adversarial harness spawns
  the real server via the shipped `createServer`, drives it over real HTTP and
  WebSocket, and calls the real SDK/MCP/benchmark packages. No audit shim, no
  fixture substitution, no weakened test.
- **Numbers are reproducible.** Benchmark table matches the generated report
  verbatim; test counts and exit codes come from the retained transcript.

**Conditions the owner must discharge before or immediately after tagging:**

1. Push to a real remote and confirm the CI `verify` **and** `docker-smoke`
   jobs pass on a runner. Until then, gates F/Docker, F/Browser E2E (as
   configured), and G/Fresh-clone remain unverified.
2. Regenerate `data/release/*` from the tagged commit so the checksum matches
   what is actually tagged.
3. If the a11y gate must be `PASS` for the public release, run an audit; if
   not, keep it declared as out of scope for v0.1.

If any of condition 1 fails on a real runner, this reverts to **NOT READY**.

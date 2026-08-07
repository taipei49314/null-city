# ADR — M8 Adversarial Release Candidate

## Status

Accepted, but its release decision is **superseded**. An external audit of the
same candidate later returned FAIL with two P0 findings against claims this ADR
treated as discharged; see
`docs/decisions/2026-08-07-authority-and-replay-semantics.md` and
`docs/audits/2026-08-07-integrity-repair.md`. The current decision is **NOT
READY TO TAG** (`03_RELEASE_GATE.md`). The reasoning below is retained because
its central argument — that a suite written by the author of the code is weak
evidence — is precisely what the external audit went on to demonstrate about
this suite too.

## Context

M0–M7 built the product and the release scaffolding, and every milestone
closed green. That is exactly the problem M8 exists to address: each suite was
written by the same process that wrote the code it tests, so a green suite is
evidence that the implementation matches its author's model, not that the
public claims survive a hostile reader.

M8's brief is to act as an independent adversarial reviewer — assume the
existing tests are complicit, attack the claims directly, and let the release
gate be decided by what actually breaks.

Two facts about this environment shaped the outcome and are recorded here
because they limit what any amount of effort could have proven: there is no
Docker daemon, and this working tree is not a git repository. No container
build and no fresh clone can be executed here.

## Decision

### 1. Attack production surfaces from outside, not the code from inside

The suite (`scripts/adversarial/`, 91 attacks in 7 modules) spawns the real
server through the shipped `createServer` and drives it over real HTTP and
WebSocket, plus the real SDK, MCP, and benchmark packages. No fixture
substitution, no test-only hook, no audit shim.

The alternative — writing more `vitest` files inside each package — was
rejected for the primary sweep because it would have inherited the same
in-process assumptions the existing suites already encode. Unit-level tests
are used where they are genuinely stronger (pure functions, schema semantics),
and as the permanent regressions for each fixed defect.

### 2. Detect truth leaks with an independent oracle, not the project's own detector

`packages/epistemics/src/leak.ts` already has leak markers. Reusing it would
have made the leak scan circular: a field the project forgot to mark as truth
would be invisible to both the product and the test.

Instead `scripts/adversarial/lib.mjs` builds a `truthOracle` directly from the
engine's internal incident and district values, and scans public payloads for
those literal values. `A1-00` is a deliberate meta-check asserting the oracle
actually holds secrets, so a clean scan can never be vacuously clean.

### 3. Test the router against an independently written algorithm

`packages/simulation/src/graph.ts` exported a `referenceShortestTravelPath`
that was a thin wrapper around `shortestTravelPath` — the function it would
have been used to check. Any comparison between them was guaranteed to pass
and proved nothing. It was unused, so it was deleted rather than fixed.

The real check is `packages/simulation/test/adversarial-graph.test.ts`: an
independently implemented Bellman-Ford over randomized graphs, plus
disconnected, blocked-route, and tie cases. Bellman-Ford was chosen precisely
because it shares no code and almost no structure with Dijkstra, so agreement
is meaningful.

### 4. Prove every regression test fails on the inherited behaviour

A regression test that passes both before and after a fix is decoration. Rather
than assert this in prose, `scripts/adversarial/prove-regressions.mjs`
mechanically reverts each of the five fixes to its exact inherited form, runs
the corresponding test file, and requires it to **fail**; a test that still
passes is reported as a `WEAK REGRESSION`. Source is restored from an in-memory
copy in a `finally` block and re-read at the end to confirm byte-identical
restoration.

Result: 5/5 proven (`data/evidence/m8-adversarial/regression-proof.txt`).

This script edits tracked source, so it is deliberately **not** part of
`pnpm verify`; it is a reviewer tool run on demand.

### 5. Introduce an `ACCEPTED` status distinct from both pass and fail

Two findings are real, reproduced, and deliberately not fixed (session
enumeration, no session cap). Recording them as `DEFENDED` would be dishonest;
leaving them as `VULNERABLE` would make `pnpm verify` permanently red, and a
permanently red check is one everybody learns to ignore — which would hide the
next real regression.

`ACCEPTED` requires a written rationale at the call site and carries a `held`
flag: if the behaviour ever changes so the attack no longer succeeds, the entry
flips to `DEFENDED` automatically rather than continuing to assert a stale
accepted risk. The gate exits non-zero only on open P0/P1.

### 6. Wire the suite into `pnpm verify`

`pnpm verify:adversarial` runs as the final stage of `pnpm verify`. It costs
roughly 20 seconds against a ~110-second chain, which is cheap enough that
splitting it into a separate CI job would cost more in configuration drift than
it saves in wall time.

### 7. Fix defects at the boundary every caller shares

Each fix is a narrow guard at an existing boundary rather than a refactor:

- Post-completion commands are answered in `rpc.ts` *before* the verification
  queue, engine, and bridge are reached, because the mutation was the bridge
  appending a `CommandResult` after the terminal event.
- The resume hash-chain check went into `validateResumeBinding` in
  `engine.ts`, not into the server, because resume is reachable from the CLI
  and the public REST transport alike and only the engine boundary is common
  to both.
- The confused-deputy fix makes the URL authoritative by ordering the spread
  (`{ ...body, sessionId }`), matching the rule the WebSocket transport
  already enforced explicitly.

### 8. Correct two README claims rather than defend them

The audit found the README asserted Docker was "CI-verified" when the CI job
has never executed (no remote exists), and did not mention the adversarial
suite in its verification summary. Both were corrected. Under
`.cursor/rules/40-release-honesty.mdc`, a claim that cannot be reproduced from
the current commit is a defect regardless of whether it is likely to be true
later.

## Alternatives considered

**Fix the two accepted findings anyway.** Capping concurrent sessions would
break the benchmark matrix, which legitimately opens many sessions; adding
authentication to suppress session enumeration is an explicit v0.1 non-goal.
Both are documented as P2/P3 with the condition that reclassifies them (any
shared or hosted deployment).

**Mark the blocked gates as PASS on the strength of code review.** Rejected
outright: `AGENTS.md` states static inspection is not runtime verification. Four
gates are `BLOCKED`/`NOT_RUN` with named blockers.

**Rewrite the leak detector to be shared between product and test.** Rejected —
that is precisely the circularity the independent oracle exists to avoid.

**Treat the tarball smoke as a fresh-clone proof.** It covers pack → extract →
import → start, which is install-and-start, not clone-and-install. Recorded as
partial evidence against a `BLOCKED` gate instead.

## Consequences

Positive:

- Twelve P0/P1 defects that seven green milestones did not surface are fixed,
  each pinned by a regression proven to fail on the inherited behaviour.
- One core invariant ("completed runs are immutable") was actually false in the
  shipped server and is now true and tested.
- `pnpm verify` gained a black-box adversarial gate that will catch a whole
  class of future regressions the unit suites structurally cannot.
- The release gate now records what was not verified as prominently as what was.

Negative / accepted:

- `pnpm verify` is ~20 seconds slower.
- The adversarial suite spawns real servers on dynamic ports, so it is heavier
  and marginally more environment-sensitive than a pure unit suite.
- `prove-regressions.mjs` mutates tracked source while it runs. It restores in
  a `finally` and verifies byte-identity, but it must never be run
  concurrently with other work on the same tree.
- Two accepted findings remain permanently visible in the report. That is
  intended: they are decisions, and they should keep being re-surfaced.

## Verification

| Command | Exit code | Result |
|---|---|---|
| `pnpm verify` | 0 | 382 tests / 59 files passing, 0 skipped; all 19 stages green (`data/evidence/m8-adversarial/verify-full.txt`) |
| `pnpm verify:adversarial` | 0 | 91 attacks: 89 defended, 0 vulnerable, 2 accepted (`data/evidence/m8-adversarial/report.md`) |
| `node scripts/adversarial/prove-regressions.mjs` | 0 | 5/5 regressions proven; source restored byte-identical |
| `node scripts/adversarial/audit-hygiene.mjs` | 0 | 0 secrets, 0 stray artifacts that would ship in a clone |

Pre-fix baseline, retained as failing evidence:
`data/evidence/m8-adversarial/prefix-baseline.txt` — 91 attacks, 16 vulnerable
(P0 5, P1 7, P2 2, P3 2), exit 1 `RELEASE BLOCKER`.

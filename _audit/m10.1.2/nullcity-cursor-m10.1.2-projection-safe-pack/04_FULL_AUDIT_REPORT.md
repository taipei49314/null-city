# NullCity M10.1.1 Final Pre-Push Audit

**Audited artifact:** `null-city-m10.1.1-final-closure.zip`  
**Audit date:** 2026-08-07  
**Decision:** **CONDITIONAL GO for a GitHub branch/PR; HOLD public release/tag until one narrow parser/projection fix and remote gates pass.**

## Executive verdict

M10.1.1 is a real closure, not a cosmetic one. The two findings that blocked M10.1 were fixed:

- The adversarial fixture is now inside the tracked test tree, and source/tests no longer rely on `_audit/`.
- Malformed `EvidenceRecorded`, incomplete claims/incidents, arrays-as-payloads, negative sequences, and over-deep values are rejected before projection.
- Fully resealed player-history attacks now fail: accepted/rejected rewrites, missing/duplicated command results, foreign player session IDs, forged incident summaries, and forged completion counts.
- Browser verification remains honestly `PARTIAL`; unsupported scopes are explicitly `NOT_CHECKED`.

The repository presentation is now GitHub-grade: README assets resolve, five scenarios and 15 benchmark runs are present, governance/release files exist, and the release archive is allowlist-based.

One release-blocking edge remains at the exact trust boundary M10.1.1 was intended to close: the clean-room browser validator validates only the outer container shape of `SystemStateChanged.teams` and `.routes`, while the truth projector assumes fully typed nested values.

## Release decision

| Action | Decision |
|---|---|
| Push current tree to a temporary branch / open a PR to obtain CI evidence | **GO** |
| Publish this exact ZIP as final public `main` | **HOLD** |
| Create `v0.1.0-alpha.1`, RC, or stable tag from this exact tree | **HOLD** |
| Apply the three-file projection-safe patch, then run remote verify + Docker smoke | **GO** |
| Add features, scenarios, UI redesign, or begin M11 | **NO** |

This is not a new milestone. It is a narrow M10.1.2 closure at the browser artifact boundary.

## What was independently verified

### Packaging and repository integrity

- ZIP entries: **383**
- Uncompressed size: **25,571,475 bytes**
- Unsafe ZIP paths: **0**
- TypeScript/TSX files syntax-parsed: **205**, errors: **0**
- JSON files parsed: **52**, errors: **0**
- README/Markdown link gate: **PASS**, 56 Markdown files, 0 missing targets
- No-external-workpack gate: **PASS**, 0 `_audit/` dependencies in apps/packages/scripts
- Release archive canary: **PASS**
- Fresh Git clone simulation: all three self-contained gates passed and the worktree remained clean

### M10.1.1 adversarial closures confirmed

The current parser/verifier correctly rejects or fails all of the following after the attacker recomputes every affected event hash, stream tip, count, and outer artifact hash:

- Player `CommandResult` accepted/rejected rewrite
- Deleting one or all player command results
- Duplicating a player command result
- Moving the player stream to another session ID
- Forging `activeIncidents`
- Forging `RunCompleted` claim/evidence counts
- `EvidenceRecorded` with a missing evidence object
- Excessively deep payloads

The honest sample remains `PARTIAL`, with truth replay, player replay, state digest, scenario digest, protocol compatibility, action ledger, and authenticity correctly marked `NOT_CHECKED` in the browser.

## Remaining blocker: nested `SystemStateChanged` values are not validated

### Root cause

`apps/command-center/src/replay/event-payloads.ts` validates:

- `districts` as an object and each district value in detail
- `teams` only as an array
- `routes` only as an object
- `resources` and its two counters

It does **not** validate each truth team or route value.

The authoritative contract in `packages/contracts/src/truth-payloads.ts` requires:

- each team to contain `teamId`, `status`, `location`, `etaTick`, and `order`
- each route value to be `{ closed: boolean }`

The browser truth projector then assumes those nested types and directly evaluates:

- `a.teamId.localeCompare(b.teamId)`
- `r.closed`

### Fully resealed reproduction A: malformed teams

Mutation applied to every `SystemStateChanged` event:

```json
{"teams": [{}, {}]}
```

After recomputing the complete truth/player hash chains and outer artifact hash:

```text
parse=PASS
verify=PARTIAL
integrityOk=true
semanticBindingsOk=true
projectTruthAtTick=THROW Cannot read properties of undefined (reading 'localeCompare')
```

### Fully resealed reproduction B: malformed routes

Mutation applied to every `SystemStateChanged` event:

```json
{"routes": {"x": null}}
```

After complete resealing:

```text
parse=PASS
verify=PARTIAL
integrityOk=true
semanticBindingsOk=true
projectTruthAtTick=THROW Cannot read properties of null (reading 'closed')
```

`ReplayLabPage` catches these two projection exceptions and returns `null`, but does not turn that state into its visible “Artifact rejected during projection” branch. The result is a loaded artifact that can leave the main Replay Lab content blank rather than being explicitly rejected.

### Why this blocks the exact release claim

This is not a hash-authenticity problem. It is a parser/projector contract mismatch on hostile input. A user-controlled, internally self-consistent artifact crosses the advertised strict parser and semantic verifier, then breaks a public UI surface. That contradicts the current M10.1.1 claim that malformed artifacts fail closed before projectors.

## Required M10.1.2 patch

Keep the change narrow:

1. Validate every `SystemStateChanged.teams[]` entry against the authoritative truth-team shape.
2. Validate every `SystemStateChanged.routes[id]` value as an object with boolean `closed`.
3. Add fully resealed regression tests for both attacks.
4. Make player/truth projection exceptions enter the visible fatal-rejection branch instead of silently returning `null`.
5. While touching the clean-room mirror, close the same outer-container-only gaps already identified by differential inspection:
   - `ScenarioStarted.districts[]` must be non-empty strings.
   - `ClaimUpdated.claim.evidenceIds[]` must be non-empty strings.
   - `ScenarioCompleted.finalScore.raw` and `.breakdown[]` must be structurally validated.
   - nullable ticks must be non-negative; assessment probability/confidence must remain in `[0,1]`.

A ready-to-review candidate patch accompanies this report. It changes only:

- `apps/command-center/src/replay/event-payloads.ts`
- `apps/command-center/src/routes/ReplayLabPage.tsx`
- `apps/command-center/test/replay-verify-m10.1.1.test.ts`

No simulation mechanics, scenarios, benchmark policy, package topology, or visual redesign are involved.

## Evidence still missing from the submitted ZIP

The project’s own `STATUS.md` and `EVIDENCE.md` honestly state that exact-commit evidence is still pending:

- commit SHA and tree hash are blank
- dependency-backed local `pnpm verify` is pending
- E2E is pending
- fresh-clone dependency-backed verify is pending
- release archive SHA/file count fields are pending
- GitHub Actions verify and Docker smoke are blocked until push

This audit environment had Node.js but no installed pnpm. Corepack attempted to obtain pnpm, but registry/DNS access failed with `EAI_AGAIN`. Therefore I did **not** claim the current tree’s full Vitest/Playwright/Docker suite passed. I independently ran the self-contained Node gates, syntax/JSON checks, fresh-clone simulation, and custom fully resealed adversarial harness.

## Final acceptance gates

After applying the narrow patch, freeze one exact commit and run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
pnpm verify:release-archive

git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --short
```

Then clone that exact commit into an empty directory and rerun at least install, verify, E2E, and release-archive verification. Push the branch and require both GitHub Actions `verify` and Docker smoke to pass.

Once those gates are green, this audit recommends:

- merge to public `main`: **GO**
- publish `v0.1.0-alpha.1`: **GO**
- call it RC/stable: reserve for a later independent release audit

## Bottom line

NullCity is already a credible public Alpha in product depth and presentation. M10.1.1 fixed the prior substantive failures. The remaining issue is one narrow, reproducible browser parser/projector mismatch—not a reason to reopen the architecture. Close it, obtain exact-tree remote evidence, and push.

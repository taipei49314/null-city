# Cursor Task — NullCity M10.1.1 Final Pre-Push Closure

## Mission

Make the current M10.1 repository independently verifiable from a clean checkout and make Replay Lab reject hostile artifacts safely. This is the final pre-push closure. No new product scope.

Read first:

- `audit/NullCity-M10.1-final-prepush-audit-v2.md`
- `02_ACCEPTANCE_GATES.md`
- `03_NO_SCOPE_DRIFT.md`
- `04_FINDINGS_MATRIX.md`

Do not claim completion from test counts alone. Every listed counterexample needs a before/after regression.

---

## P0-A — Remove the excluded audit-fixture dependency

Current tracked test:

```text
apps/command-center/test/replay-verify-m10.1.test.ts
```

loads:

```text
_audit/m10.1/reproduction/minimal-semantic-forgery.artifact.json
```

The source ZIP and generated release archive contain the test but not that fixture. A fresh checkout therefore fails while importing the test module.

Required work:

1. Copy the supplied `recovery/minimal-semantic-forgery.artifact.json` to a tracked test path, preferably:

   ```text
   apps/command-center/test/fixtures/minimal-semantic-forgery.artifact.json
   ```

2. Update the test to use that tracked fixture.
3. Add a deterministic gate that rejects source/test file reads or imports from `_audit/` and other excluded workpack paths.
4. Prove the release archive contains both the test and the fixture.
5. Prove the test loads and runs in a fresh clone with no `_audit/` directory.

Do not publish `_audit/` as the fix.

---

## P0-B — Make artifact parsing and rendering fail closed

Current browser parsing validates event envelopes only shallowly. A fully resealed `EvidenceRecorded` event with payload `{}` can receive:

```text
status=PARTIAL
integrityOk=true
semanticBindingsOk=true
```

Then `buildEvidenceProvenance()` throws while reading `evidence.id`. A deeply nested payload can also make canonical JSON verification throw `RangeError: Maximum call stack size exceeded`.

Required work:

1. Implement strict discriminated runtime validation for every supported truth and player event kind before verification or projection.
2. Preserve the browser truth-boundary rule: do not import simulation or privileged truth runtime code into Command Center. Use clean-room local validators or a deliberately safe public validation surface.
3. Validate required fields, exact scalar types, finite integers/ranges, enum values, arrays, object depth, string lengths, and collection/event-count ceilings.
4. Replace or guard recursive canonicalization so excessive depth becomes a controlled verification error, not an uncaught stack overflow.
5. `ArtifactLoader` must not call `onLoaded` for `FAIL` artifacts.
6. Replay Lab must never run projections, provenance generation, comparisons, or exports for rejected artifacts.
7. Add guarded error handling so unexpected artifact failures render a rejection message instead of crashing the route.

Mandatory malformed-payload regressions:

- `EvidenceRecorded` with missing `evidence`;
- `ClaimUpdated` with missing claim fields;
- `SystemStateChanged` with invalid payload;
- `TrueIncidentOccurred` with incomplete payload;
- player payload as an array;
- excessive nested-object depth;
- excessive event count / collection size;
- invalid negative or non-integer sequence/tick/count values.

Every negative artifact must either fail parsing or return `status=FAIL`; it must not reach any projector.

---

## P1 — Close browser semantic bindings or mark them NOT CHECKED

The browser must remain `PARTIAL`; full replay remains CLI-only. Within browser scope, however, `Semantic bindings: PASS` must be precise.

Required minimum:

1. Every truth `CommandIssued` has exactly one terminal truth outcome.
2. Every terminal truth outcome has exactly one matching player `CommandResult`.
3. Every player `CommandResult` has exactly one matching truth outcome.
4. Command ID, idempotency key, outcome, and session ID match across all three records.
5. Reject duplicate, missing, and unresolved result relationships.
6. Every truth and player envelope uses `identity.sessionId`.
7. Derive `handledIncidents` and `activeIncidents` from truth events, or report the unavailable field as `NOT CHECKED`.
8. Derive `RunCompleted.claimCount` and `evidenceCount` from the final player projection, or report them as `NOT CHECKED`.
9. `publicActionLedger`, scenario content digest, protocol compatibility, state digest, authenticity, truth replay, and player replay must each have an explicit checked/not-checked status. Do not hide them under a broad green semantic boolean.
10. Remove or harden the deprecated `ok` field so no caller can treat `PARTIAL` as complete verification.

Mandatory fully resealed regressions:

- accepted/rejected state rewrite;
- delete one player `CommandResult`;
- delete every player `CommandResult`;
- duplicate a player result with a valid rechain;
- player stream moved to another session ID;
- forged active-incident summary;
- forged completion claim/evidence counts;
- erased public action ledger;
- valid-shape forged protocol version and scenario digest must be explicitly `NOT CHECKED` unless independently bound.

Each attack must recompute event hashes, stream tips, counts, and outer `artifactHash`. Unresealed edits are not evidence.

---

## P1 — Replace stale evidence with exact-tree evidence

The bundled transcript predates M10.1 and the delivered archive does not reproduce the tree hash claimed in `EVIDENCE.md`.

Before declaring ready, capture from one exact final commit:

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --short
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
pnpm verify:markdown-links
pnpm verify:release-archive
```

Then create a new clone in an empty directory from the same commit and rerun:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
```

Inspect the generated release archive and prove:

- the M10.1 test is present;
- every fixture it reads is present;
- no source/test reference points to `_audit/`;
- the archive can pass the appropriate source-package/fresh-clone gate.

Finally push a branch and require both GitHub Actions jobs, including Docker smoke, to pass. Record workflow links/IDs, exact commit, exact tree, and clean worktree in `EVIDENCE.md`.

Do not reuse the old transcript or old commit identity.

---

## Completion output

Return:

- exact commit SHA and tree hash;
- clean `git status --short`;
- complete local verify transcript and exit codes;
- complete fresh-clone transcript and exit codes;
- generated release archive SHA-256 and file count;
- proof that the M10.1 test and fixture are both packaged;
- before/after table for every supplied adversarial case;
- remote GitHub Actions verify and Docker-smoke results;
- final source archive from the exact green commit.

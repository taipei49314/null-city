# NullCity M10.1 Final Pre-Push Audit — Revision 2

**Audit date:** 2026-08-07  
**Artifact:** `null-city-m10.1-prepush-closure.zip`  
**Size:** 2,248,204 bytes  
**SHA-256:** `e758fbf87f99ca929e3db73d5c9642d396e5b3b1920030fff76bff7224c2c41e`

## Executive decision

**HOLD this exact ZIP. Do not publish it as the public `main` branch and do not tag it.**

NullCity itself is now at public-Alpha product quality. The remaining work is not another feature milestone or architectural rewrite. It is a small **M10.1.1 fresh-clone and fail-closed closure** concentrated in Replay Lab tests, artifact parsing, semantic bindings, and exact-commit evidence.

### Release ladder

| Action | Decision |
|---|---|
| Push this exact archive as public `main` | **NO-GO** |
| Tag `v0.1.0-alpha.1` from this archive | **NO-GO** |
| Apply M10.1.1, then push a branch / pull request | **GO** |
| Merge after exact-commit `verify` + Docker smoke are green | **GO** |
| Tag `v0.1.0-alpha.1` after those remote gates | **GO** |
| Tag `v0.1.0-rc.1` now | **NO-GO** |
| Tag stable `v0.1.0` now | **NO-GO** |

## What M10.1 successfully closed

The previous public Replay Lab false-PASS defect is materially fixed:

- An honest artifact is labelled `PARTIAL`, not full PASS.
- Truth replay and player projection replay are explicitly reported as not run in the browser.
- A fully resealed contradiction where truth says `CommandAccepted` but the player event says `rejected` is rejected as `FAIL`.
- README wording now distinguishes active-run truth isolation from post-run truth reveal.
- Five scenarios, screenshots, governance files, benchmark data, replay artifacts, and release documentation are present.
- Markdown links resolve and the release allowlist/canary checks pass.

This means the M10 product direction is correct. The package still fails the final reproducibility and hostile-input gates below.

---

# P0-01 — Fresh checkout cannot load the new M10.1 test

The tracked test:

```text
apps/command-center/test/replay-verify-m10.1.test.ts
```

performs a top-level file read at lines 13–16:

```ts
const MINIMAL_FORGERY_RAW = readFileSync(
  join(HERE, "../../../_audit/m10.1/reproduction/minimal-semantic-forgery.artifact.json"),
  "utf8",
);
```

But the delivered source ZIP contains no `_audit/` directory and no `minimal-semantic-forgery.artifact.json`. The generated public release tarball contains the test but still omits the fixture.

Direct reproduction from the delivered tree:

```text
expected path:
/nullcity/_audit/m10.1/reproduction/minimal-semantic-forgery.artifact.json

result:
FileNotFoundError / ENOENT
```

Because the read occurs while the test module is imported, Vitest fails before the test suite can run. This is deterministic and does not depend on pnpm availability in the audit environment.

## Required fix

1. Move the negative fixture into a tracked path such as:

   ```text
   apps/command-center/test/fixtures/minimal-semantic-forgery.artifact.json
   ```

2. Update the test to read only the tracked fixture.
3. Add a source/release gate that rejects test or runtime references to `_audit/` and other excluded workpack paths.
4. Prove both the test and fixture exist in the generated release archive.
5. Run the suite from an empty clone of the exact commit, with no `_audit/` directory available.

Do not solve this by publishing `_audit/`; public tests must be self-contained.

---

# P0-02 — A hostile artifact can pass browser checks and crash Replay Lab

`parseReplayArtifact()` checks that an event payload is an object, but it does not validate the payload against the event kind. For example, an `EvidenceRecorded` event with this payload is accepted:

```json
{}
```

After fully recomputing the player hash chain and outer artifact hash, the actual browser verifier returned:

```json
{
  "status": "PARTIAL",
  "integrityOk": true,
  "semanticBindingsOk": true,
  "reasons": []
}
```

Replay Lab then calls `buildEvidenceProvenance()`, which assumes:

```ts
const evidence = payload.evidence;
evidence.id
```

and throws:

```text
TypeError: Cannot read properties of undefined (reading 'id')
```

A second hostile artifact with a deeply nested payload caused the canonical JSON verifier to throw:

```text
RangeError: Maximum call stack size exceeded
```

This matters because Replay Lab accepts file-drop artifacts as untrusted input. A malformed artifact must be rejected safely; it must not reach projections or crash the page.

## Required fix

1. Add strict, discriminated runtime schemas for every supported truth and player event kind.
2. Validate required fields, scalar types, integer/range constraints, array cardinality, maximum depth, and maximum event counts before hashing or projection.
3. Bound or replace recursive canonicalization so deeply nested input produces a controlled parse/verify error.
4. Do not call `onLoaded`, projections, provenance builders, or report generators for `FAIL` artifacts.
5. Add an error boundary or guarded conversion so unexpected artifact errors render a rejection message rather than crash Replay Lab.
6. Add regression tests for malformed `EvidenceRecorded`, `ClaimUpdated`, `SystemStateChanged`, `TrueIncidentOccurred`, and excessive nesting.

---

# P1-01 — Browser “Semantic bindings: PASS” remains broader than its checks

The browser correctly stays `PARTIAL`, so this is not a return of the former full-PASS defect. However, the following fully resealed changes still produce:

```text
status=PARTIAL
integrityOk=true
semanticBindingsOk=true
reasons=[]
```

Observed cases:

- delete one player `CommandResult` while truth still contains the outcome;
- duplicate a player `CommandResult`;
- move player events to a foreign session ID;
- forge `activeIncidents`;
- erase `publicActionLedger`;
- forge `RunCompleted.claimCount` and `evidenceCount`;
- replace valid-shape `scenarioDigest` or `engineProtocolVersion` values.

The label therefore implies more semantic coverage than the implementation provides.

## Required fix

- Enforce exactly one truth `CommandIssued`, one terminal truth outcome, and one player `CommandResult` per command.
- Cross-bind command ID, idempotency key, outcome, and session identity in both directions.
- Reject duplicate, missing, and unresolved result relationships.
- Derive handled/active incident summaries where the browser has sufficient information; otherwise mark them `NOT CHECKED`.
- Derive terminal claim/evidence counts where possible; otherwise mark them `NOT CHECKED`.
- Treat scenario content digest, protocol compatibility, state digest, public action replay, authenticity, and full projection replay as explicitly unverified unless the browser actually proves them.
- Consider replacing the broad boolean `semanticBindingsOk` with named per-scope statuses so downstream code cannot mistake partial success for full semantic verification.

---

# P1-02 — Included release evidence does not belong to the final delivered tree

`STATUS.md` and `EVIDENCE.md` claim a fully green exact commit, but the bundled transcript predates the M10.1 verifier and test changes.

The transcript does not contain the current stages:

- `verify:markdown-links`
- `verify:audit-repro`
- `replay-verify-m10.1`

It reports 11 Command Center test files, while the delivered tree contains 13. File timestamps show the transcript was produced before the new verifier, test, and final package metadata.

The delivered archive also does not reproduce the claimed Git tree:

```text
claimed tree:   ce6c0611091d6f5edb3c84613cae64de87b134ef
delivered tree: 5c5f510b31ffbb707b3e7ff8714d75388e2f870e
match:          false
```

This does not prove the code cannot pass. It proves the attached evidence cannot certify this exact source package. The missing fixture independently shows the final package was not verified from a clean checkout.

## Required evidence after the patch

Capture from the exact final commit:

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --short
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
pnpm verify:release-archive
```

Then repeat the install and verification from a new empty clone. After push, require both GitHub Actions jobs—including Docker smoke—to be green before merging or tagging.

---

# Independent checks that passed

| Check | Result |
|---|---|
| ZIP safety | 378 entries; no traversal or symlinks |
| TypeScript / TSX syntax | 202 files, 0 syntax errors |
| JS / MJS / CJS syntax | 28 files, 0 syntax errors |
| JSON parsing | 51 files, 0 errors |
| Workspace manifests | 11 manifests, unique names |
| Missing workspace dependencies | 0 |
| Lockfile/importer consistency | 11 importers, 0 errors |
| Required public files | 0 missing |
| README screenshots | Both present with valid PNG signatures |
| Markdown local targets | 56 files, 0 missing targets |
| Release allowlist dry run | 378 selected files, PASS |
| Release archive canary | 5 planted, excluded correctly, PASS |
| Basic credential-pattern scan | 0 suspicious hits |
| Honest browser artifact wording | PARTIAL, replay NOT RUN |
| Fully resealed accepted/rejected contradiction | Rejected as FAIL |
| Five golden receipts | Internally self-consistent |

# Runtime limitations of this audit environment

The environment had Node.js but no usable pnpm installation or Docker daemon. Corepack attempted to fetch pnpm and registry DNS failed. Therefore the audit did not independently rerun the complete `pnpm verify`, E2E, or Docker compose pipeline.

That limitation does not affect:

- the missing-fixture failure, which is a direct top-level file read against an absent path;
- the release-archive omission, inspected directly;
- the browser verifier and projection reproductions, executed against transpiled copies of the actual current source;
- the stale transcript and tree-identity mismatch.

# Final label

> **NullCity is product-ready for a serious public Alpha, but this exact M10.1 package is not push-ready. Apply the small M10.1.1 closure, prove it from an empty clone and the exact pushed commit, then publish. Do not open another feature milestone.**

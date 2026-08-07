# Cursor Prompt — NullCity M10 Integrity Closure

You are performing a release-integrity closure on the existing NullCity repository.

Do not redesign the product. Do not add scenarios or UI features. The repository already has enough product surface. Your task is to eliminate the exact release blockers documented in the attached M9 audit, prove the fixes with resealed adversarial counterexamples, and create evidence for the exact final Git tree.

Read first:

- `AGENTS.md`
- `00_NORTH_STAR.md`
- `03_RELEASE_GATE.md`
- `05_KNOWN_FINDINGS.md`
- the supplied `00_RELEASE_AUDIT.md`
- `02_FINDINGS_MATRIX.md`
- `03_ACCEPTANCE_GATES.md`

## Non-negotiable scope

Implement only these workstreams, in order.

### Workstream A — Make claim verification real

The public meaning of `REQUEST_VERIFICATION` must be unambiguous.

- Canonical public params: `{ teamId, claimId }`.
- The server resolves the claim's district and constructs engine params internally.
- Do not allow `claimId` and a caller-provided `target` to become competing sources of truth.
- Update `verification-first` to send `claimId`, not district `target`.
- Audit Command Center, SDK, MCP and benchmark adapters for parity.
- If generic district inspection is still a legitimate engine operation, give it a different internal/public command name. Do not overload claim verification.
- Rejected commands must leave no pending mapping or bridge state.

Required proof:

- An end-to-end run emits `VerificationResolved`.
- The intended claim transitions to `verified` or `refuted`.
- `resolvedClaimCount > 0` for verification-first in at least one scenario designed to contain resolvable claims.
- A test mechanically restoring `{teamId,target}` in the policy must fail.

### Workstream B — Artifact v2: independently reconstruct player history

The current verifier replays truth but only validates the provided player stream's self-consistency. That is insufficient.

Design a versioned artifact format that can deterministically regenerate the public/player stream from independent inputs.

Minimum design requirements:

- Preserve compiled scenario identity and digest.
- Preserve truth event stream and deterministic truth replay.
- Add a canonical public-action ledger for player-originated actions that truth alone cannot reconstruct, including assessments and claim-targeted verification intent.
- Cross-bind public command actions to truth `CommandIssued` and exactly one accepted/rejected outcome by command ID and idempotency key.
- Rebuild the player projection from scenario + regenerated truth + canonical public actions.
- Compare the regenerated complete player log hash and event count with the artifact.
- Validate terminal `RunCompleted` fields, including claim/evidence counts, against reconstructed terminal public state.
- Keep tamper evidence distinct from authenticity. No signature means no authenticity claim.

Do not merely hash the provided player log again. An attacker can do that too.

Required proof:

- The supplied forged player-history artifact is rejected for a semantic truth/player mismatch after all hashes have been recomputed.
- Mutating `CommandResult`, `ClaimUpdated`, `EvidenceRecorded`, `VerificationResolved`, or terminal claim/evidence counts and resealing must fail.
- Same scenario + seed + public-action ledger reproduces identical truth and player roots.

### Workstream C — Honest CLI verification levels

Change `null-city-run verify` and `compare` so they never print an undifferentiated PASS after integrity-only checks.

- Default full verification must resolve and compile the scenario and call the verifier with `requireReplay: true`.
- Add an explicit `--scenario <path>` if automatic registry resolution is not sufficient.
- An explicit `--integrity-only` mode may exist, but must print `PARTIAL` or `INTEGRITY-ONLY`, never `PASS full verification`.
- Use a distinct exit code for partial verification.
- Output separate fields for:
  - envelope/hash integrity
  - truth replay
  - player projection replay
  - signature/authenticity
- `compare` must refuse to label either input independently verified unless full replay passed.

Required proof:

- The supplied weak-CLI forged artifact exits nonzero under default verify.
- Removing the scenario makes default verify fail clearly rather than silently downgrade.
- `--integrity-only` reports its limited scope in machine-readable and human-readable output.

### Workstream D — Retire or harden legacy RunReceipt

There must not be two public formats that both appear to provide full verification while one accepts rewritten identity metadata.

Choose one and document the decision:

1. Deprecate `RunReceipt v1` as a legacy integrity receipt and route public users to artifact v2; or
2. Require compiled scenario replay and cross-bind scenario ID, digest, seed, final tick, state digest and terminal summaries.

Required proof:

- The supplied forged Red Ledger receipt is rejected, or the old full-verify command has been removed/replaced with an explicitly limited integrity command.
- Golden receipt tooling and documentation use the same terminology.

### Workstream E — Make the audit adversarial

Fix `scripts/verify-audit-repro.mjs`.

- Every mutation test must reseal every hash an attacker can compute.
- Reuse production canonicalization helpers where possible.
- Assert the specific semantic rejection reason, not merely `ok === false`.
- Add regressions for:
  - forged scenario/state digests
  - rewritten player `CommandResult`
  - rewritten terminal claim/evidence counts
  - legacy receipt identity rewrite
  - policy sending district target instead of claim ID

A test that fails only because `artifactHash mismatch` after an unresealed edit is not adequate evidence.

### Workstream F — Regenerate all public evidence from the final tree

After A–E are complete:

- Regenerate every artifact fixture through production builders.
- Replace the stale Command Center sample artifact whose event follows `RunCompleted`.
- Run the full 5 scenarios × 3 policies = 15 benchmark matrix.
- Ensure Red Ledger appears in the report.
- Generate the README benchmark excerpt from the machine-readable benchmark output; do not hand-copy numbers.
- Update all references from three/four scenarios to five where accurate.
- Remove claims about debunking or information gain unless the report actually contains resolved claims and the measured value.

Then freeze the tree and produce release evidence:

```bash
pnpm install --frozen-lockfile
pnpm verify
git diff --exit-code
git status --porcelain
```

Record:

- exact Git commit SHA
- Git tree hash
- Node and pnpm versions
- complete command transcript and exit code
- test files/tests/skips
- 15 benchmark rows
- Docker result as PASS / FAIL / BLOCKED
- fresh-clone result as PASS / FAIL / BLOCKED

If the directory is not a real Git repository, do not invent a commit identity. Mark the exact-commit and fresh-clone gates BLOCKED and do not claim tag readiness.

## Required deliverables

- source changes only within M10 scope
- ADR for artifact v2 / legacy receipt decision
- updated `STATUS.md`
- updated `EVIDENCE.md`
- finding-to-test matrix
- before/after outputs for every supplied reproduction
- machine-readable verifier output examples
- exact final source archive

## Stop conditions

Stop and report FAIL/BLOCKED rather than claiming completion if any of these are true:

- verification-first still has zero resolved claims across all five scenarios
- default CLI verify can pass without scenario replay
- a resealed player-history contradiction is accepted
- README differs from generated benchmark output
- final source changes after the full verify transcript
- Docker or fresh-clone gates are not executed but are described as PASS

Do not start M11. M10 ends only when the integrity closure is independently reviewable.

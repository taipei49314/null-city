# M10 Acceptance Gates

Every gate is mandatory for `READY FOR INDEPENDENT RE-REVIEW`. Tag readiness still additionally requires live CI, Docker and fresh-clone evidence.

## Gate A — Verification semantics

- [ ] Public `REQUEST_VERIFICATION` has one canonical claim-directed shape.
- [ ] `verification-first` sends claim ID.
- [ ] At least one full run emits `VerificationResolved`.
- [ ] Resolved claim count is nonzero in applicable verification-first runs.
- [ ] Rejected verification command leaves no pending mapping.
- [ ] SDK, MCP, browser and benchmark share the same contract.

## Gate B — Artifact truth/player binding

- [ ] Artifact version is bumped or migration is explicitly documented.
- [ ] Truth replay passes from scenario + seed + command actions.
- [ ] Player projection replay passes from independent canonical inputs.
- [ ] Rewritten player command outcome is rejected after full reseal.
- [ ] Rewritten evidence/claim/verification event is rejected after full reseal.
- [ ] Rewritten terminal claim/evidence count is rejected after full reseal.
- [ ] Verifier reports truth replay and player replay separately.

## Gate C — CLI honesty

- [ ] Default `run verify` requires scenario replay.
- [ ] Missing scenario does not silently downgrade.
- [ ] Integrity-only mode is opt-in and prints PARTIAL/INTEGRITY-ONLY.
- [ ] Compare never labels hash-only inputs independently verified.
- [ ] Machine-readable output includes verification level and replay booleans.

## Gate D — Legacy receipt

- [ ] Forged scenario ID/seed/final tick receipt no longer receives full PASS.
- [ ] Docs use unambiguous integrity vs replay vs authenticity terminology.
- [ ] Golden tooling follows the selected deprecation/hardening ADR.

## Gate E — Adversarial quality

- [ ] All mutation tests recompute attacker-computable hashes.
- [ ] Tests assert semantic failure reasons.
- [ ] Restoring the vulnerable implementation makes each new test fail.
- [ ] Supplied M9 reproductions are included in the gate.

## Gate F — Product evidence

- [ ] All committed artifact fixtures pass the production full verifier.
- [ ] Benchmark contains exactly 15 rows: 5 scenarios × 3 policies.
- [ ] Red Ledger is present.
- [ ] Applicable verification-first runs resolve claims.
- [ ] README scenario count is five.
- [ ] README benchmark excerpt is generated and exactly matches report data.

## Gate G — Exact tree

- [ ] Real Git commit SHA recorded.
- [ ] Git tree hash recorded.
- [ ] `pnpm install --frozen-lockfile` exit 0.
- [ ] `pnpm verify` exit 0 on that exact tree.
- [ ] Transcript includes `verify:audit-repro`, all five scenarios and all 15 benchmark runs.
- [ ] `git diff --exit-code` exit 0 after verification.
- [ ] `git status --porcelain` empty after verification.
- [ ] Release archive generated from the same commit.
- [ ] No source/docs/generated evidence changed after the transcript.

## Gate H — External tag blockers

- [ ] Remote CI executed on the exact commit.
- [ ] Docker smoke executed against the exact commit.
- [ ] Fresh clone install/build/test executed.

A BLOCKED item remains BLOCKED. It is never converted to PASS through documentation review alone.

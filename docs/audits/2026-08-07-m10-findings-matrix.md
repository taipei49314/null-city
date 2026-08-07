# M10 finding-to-test matrix

| Finding | Fix | Proof |
|---|---|---|
| P0-01 claim verification inert | Public `claimId` contract; policy + CC + transport; `INSPECT_DISTRICT` split | `packages/server/test/m10-verification-claim.test.ts`; policy source guard; VerificationResolved E2E |
| P0-02 player history forge | Artifact v2 ledger + player rebuild; per-tick advance publish | `packages/simulation/test/adversarial-artifact.test.ts` M10 P0-02; `scripts/verify-audit-repro.mjs` A2 |
| P0-03 weak CLI PASS | Default `requireReplay`; `--integrity-only` PARTIAL/exit 2 | `packages/simulation/src/cli/run.ts`; audit-repro C |
| P1-01 legacy receipt rewrite | Receipt CLI is integrity/PARTIAL only; ADR | `receipt-verify.ts`; ADR `2026-08-07-m10-integrity-closure.md` |
| P1-02 unresealed adversarial | Audit repro reseals every mutation and asserts semantic reasons | `scripts/verify-audit-repro.mjs` |
| P1-03/04 fixture/bench drift | Regenerate via production builders (`generate-m4-artifacts.mjs`) | `data/m4-run-*.artifact.json`; CC `sample-run.artifact.json` |
| P2-01 post-`RunCompleted` event | Production builders + per-tick publish | Regenerated sample ends on `RunCompleted` |

Stop conditions (from kickoff) remain binding: do not claim READY TO TAG if Docker/CI/clone are invented PASS.

# M10 Finding Matrix

| ID | Severity | Failure | Required code area | Minimum regression |
|---|---|---|---|---|
| P0-01 | P0 | `verification-first` sends district target, server requires claim ID to resolve claim | benchmark policy, RPC, adapters, contracts | policy run emits `VerificationResolved`; resolved claims > 0 |
| P0-02 | P0 | truth replay does not regenerate player history | artifact format/verifier, server public projector | resealed accepted→rejected `CommandResult` is rejected semantically |
| P0-03 | P0 | official CLI calls verifier without scenario and prints PASS | run CLI, scenario registry/loader | forged state/scenario digest exits nonzero by default |
| P1-01 | P1 | legacy receipt permits rewritten scenario/seed/final metadata | receipt verifier/CLI/docs | resealed forged receipt rejected or command explicitly deprecated |
| P1-02 | P1 | audit repro changes data without resealing | audit scripts/tests | every attack reseals and asserts exact semantic reason |
| P1-03 | P1 | verify evidence predates final Red Ledger tree | release process/evidence | exact commit/tree, clean post-verify status, no later edits |
| P1-04 | P1 | README says 3 scenarios and contains stale/false benchmark numbers | docs generator/CI | README excerpt byte-matches generated 15-run report |
| P2-01 | P2 | sample artifact has event after `RunCompleted` | fixture generation | every committed artifact fixture passes production full verifier |

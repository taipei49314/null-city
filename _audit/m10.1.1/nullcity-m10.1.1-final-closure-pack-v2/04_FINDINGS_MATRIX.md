# Findings Matrix

| ID | Severity | Current behavior | Required closure |
|---|---|---|---|
| NC-M10.1-001 | P0 | Test reads omitted `_audit/...json`; fresh clone throws ENOENT | Move fixture into tracked test fixtures; add no-external-workpack gate |
| NC-M10.1-002 | P0 | Malformed `EvidenceRecorded {}` reseals, browser semantic check stays green, provenance crashes | Per-kind runtime schema; rejected artifacts never projected |
| NC-M10.1-003 | P0 | Deeply nested payload throws stack overflow during canonicalization | Bound depth / iterative or guarded canonicalization |
| NC-M10.1-004 | P1 | Missing or duplicate player result remains semantic green | Enforce exact 1:1:1 command binding |
| NC-M10.1-005 | P1 | Foreign player session ID remains semantic green | Bind all envelopes to artifact identity session |
| NC-M10.1-006 | P1 | Forged active incidents and completion counts remain semantic green | Derive or mark fields NOT CHECKED |
| NC-M10.1-007 | P1 | Public ledger, scenario digest, protocol version broadly implied by semantic PASS | Expose named checked/not-checked scopes |
| NC-M10.1-008 | P1 | Bundled verify transcript predates final source/test tree | Regenerate exact-commit local, fresh-clone, and remote evidence |

# AGENTS.md — NullCity Repository Contract

## Mission

Build NullCity into a serious open-source crisis-decision benchmark while preserving evidence, scope discipline, and deterministic behavior.

## Authority hierarchy

1. Current milestone workpack and explicit user instruction.
2. `00_NORTH_STAR.md` and `01_TARGET_ARCHITECTURE.md`.
3. This file and `.cursor/rules/*`.
4. Existing code and tests, unless they conflict with a confirmed defect or higher-level contract.

Cursor is the primary implementer. External reviewers may challenge results, but should not silently replace implementation. Cursor may not self-approve a milestone or release.

## Mandatory workflow

1. Inspect before editing.
2. Plan before editing.
3. Implement only the active milestone.
4. Add executable tests for each claim.
5. Run verification commands and record exit codes/results.
6. Inspect the complete diff.
7. Update `STATUS.md`, `EVIDENCE.md`, and material ADRs.
8. Stop at the milestone boundary.

## Evidence rules

- `PASS` requires an executed check and retained evidence.
- Use `FAIL`, `BLOCKED`, or `NOT_RUN` honestly.
- Static inspection is not runtime verification.
- Do not hide, delete, or overwrite failing evidence.
- Report skipped tests, warnings, flaky behavior, and environment gaps.
- Never write “all tests pass” without command, exit code, and result count.
- A hash chain is tamper-evident only. Authenticity requires a trusted external key/root.

## Scope rules

- No opportunistic refactor.
- No later-milestone implementation without a direct current-milestone dependency.
- No cloud service, auth, external database, hosted leaderboard, plugin framework, or LLM provider in the deterministic core.
- No mock-only or fixture-only substitute for a required vertical slice.
- No disabled CI, skipped critical test, `test.only`, or broad ignore added to obtain green status.
- Do not rewrite the project from scratch unless an ADR proves incremental repair cannot satisfy the invariant.

## Core invariants

- The simulation uses seeded deterministic inputs only.
- Player-facing packages cannot import internal truth types or stores.
- Player state is derived from player events, not direct truth masking.
- Every future-output-affecting field is in a versioned snapshot.
- Snapshot and resume clone/deserialize values and validate identity/digests.
- Completed runs are immutable and emit one terminal result.
- Public transport is session-scoped and runtime-validated.
- Event verification checks schema, stream, session, sequence, tick, anchors, and hashes.
- Source scenarios are semantically compiled before engine construction.
- Human and agent clients use the same public contract.

## Testing expectations

Use the smallest sufficient combination of:

- unit tests for pure functions and schemas;
- invariant tests for event/snapshot/finalization rules;
- property/randomized tests for graph, snapshot, and scenario compiler behavior;
- integration tests for session and transport boundaries;
- browser E2E for actual Command Center flows;
- pack/install/start and fresh-clone smoke tests for release work.

A test must attack the claim, not repeat the implementation.

## Code quality

- TypeScript strict mode stays enabled.
- Runtime boundaries use runtime schemas; TypeScript casts are not validation.
- Prefer explicit domain names and units.
- Keep deterministic core free of wall-clock, network, filesystem, environment, and model-provider access.
- Keep public API changes documented and tested.
- Avoid giant files; refactor only when a cohesive boundary is clear and covered.
- Error messages must be actionable and stable enough for tests without exposing secrets or truth.

## Git and reporting

- Use logical checkpoint commits when authorized.
- Do not mix unrelated formatting churn with functional changes.
- Record material architecture decisions under `docs/decisions/`.
- Final milestone report includes changed files, commands, exit codes, test counts, risks, deviations, unverified areas, and commit hashes.

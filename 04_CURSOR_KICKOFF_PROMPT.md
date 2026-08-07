# Cursor kickoff prompt — paste into Plan Mode

You are the primary implementation agent for the existing NullCity repository.

Read, in order:

1. `README_FIRST.md`
2. `00_NORTH_STAR.md`
3. `01_TARGET_ARCHITECTURE.md`
4. `02_MILESTONE_ROADMAP.md`
5. `05_KNOWN_FINDINGS.md`
6. `AGENTS.md`
7. `.cursor/rules/*`
8. `workpacks/M0-kernel-recovery.md`
9. the existing source, tests, lockfile, and package configuration

Your task is to plan and implement **M0 only: Kernel Recovery Vertical Slice**.

## Before editing

Inspect the repository comprehensively. Reproduce or independently verify every inherited P0 claim relevant to M0. Determine the actual package-manager and runtime state. Do not assume the old audit environment or claims are correct merely because they are documented.

Produce a reviewable M0 implementation plan containing:

- current architecture and exact files implicated;
- invariants to preserve or introduce;
- proposed public/internal event and snapshot changes limited to M0;
- migration strategy that avoids an unnecessary rewrite;
- tests to add before or with each fix;
- exact verification commands;
- risks, compatibility breaks, and rollback points;
- intended logical commits;
- explicit out-of-scope items from M1+.

Do not edit code until the plan is internally consistent. Do not ask routine clarification questions. Resolve ambiguity from repository evidence and document assumptions in `docs/decisions/` when material.

## Implementation constraints

- Preserve working behavior unless M0 requires a change.
- No opportunistic UI, MCP, benchmark, scenario expansion, cloud, auth, database, plugin, or provider work.
- No raw truth path may remain available to a player transport.
- A snapshot must be a detached, versioned, fully validated value.
- A completed run must reject all mutation without changing any digest, event count, or score.
- Event verification must validate more than recomputed hash links.
- Do not call an unsigned hash chain authenticated.
- Add regression tests that fail on the inherited behavior.
- Run real commands. Never claim PASS from inspection alone.
- Do not delete or weaken existing tests merely to obtain green status.
- Inspect the full diff before final reporting.

## Required M0 outputs

- production code and regression tests;
- a real CLI end-to-end path that runs `Black River` to completion and writes/verifies a run receipt;
- corrected build/package exports and production start smoke path where required by M0;
- `STATUS.md` using `templates/STATUS_TEMPLATE.md`;
- `EVIDENCE.md` using `templates/EVIDENCE_TEMPLATE.md`;
- material decisions under `docs/decisions/`;
- logical checkpoint commits or a clearly grouped uncommitted diff if commit authority is unavailable.

## Stop condition

After M0 implementation and verification, stop. Report:

- changed files and rationale;
- commands, exit codes, and result counts;
- reproduction status for each inherited P0;
- acceptance criterion status;
- unverified areas;
- risks and deviations;
- exact commit hashes if committed.

Do not begin M1 and do not declare the milestone accepted on your own.

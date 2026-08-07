# Contributing to NullCity

Thanks for taking the time to contribute. NullCity is a benchmark, so its
credibility depends on defect-first review, honest evidence, and not
weakening the invariants below to make something green.

## Before you start

Read, in order:

1. [`00_NORTH_STAR.md`](00_NORTH_STAR.md) — product identity and what is
   explicitly **not** in scope for this project.
2. [`01_TARGET_ARCHITECTURE.md`](01_TARGET_ARCHITECTURE.md) — package
   boundaries, the truth/public contract split, and the dependency graph.
3. [`AGENTS.md`](AGENTS.md) — the repository's operating contract (this
   applies to human contributors too, not just AI agents).
4. [`docs/architecture.md`](docs/architecture.md) and
   [`docs/protocol.md`](docs/protocol.md) for the current implementation.

## Non-negotiable invariants

These are enforced by tests (`test/forbidden-imports.test.ts`, `test/leak.test.ts`
in every player-facing package) and by review, not just convention:

- The deterministic simulation core (`packages/simulation`) never touches
  the wall clock, network, filesystem, environment variables, UI, MCP, or an
  LLM provider.
- Player-facing packages (`command-center`, `sdk`, `benchmark`, `mcp-server`)
  never import `@null-city/simulation` internals, truth-only
  `@null-city/contracts` symbols, or `@null-city/epistemics` from `src/`
  (leak-detection is a **dev**-only dependency, used only in tests).
- A completed run is immutable: no command, assessment, or admin call may
  mutate it afterward.
- A hash chain is tamper-evident, not a cryptographic signature. Never
  describe one as the other in code, docs, or PR descriptions.

## Development setup

```bash
pnpm install
pnpm build
pnpm verify
```

`pnpm verify` is the single command that must pass before any PR is
reviewable: lint, typecheck, build, every package's unit/integration tests,
the determinism/invariant suites, package/tarball smoke, and the scenario,
SDK, benchmark, and MCP quickstarts. It does not require Docker, an internet
connection beyond the initial `pnpm install`, or any API key.

## Adding or changing a scenario

Scenarios are pure JSON under `scenarios/`. Adding one needs no change to the
schema, engine, or server, but it does need a registry entry in
`packages/test-fixtures` and — to appear in the browser Command Center's launch
picker and map — a topology entry in `apps/command-center/src/topology/`.
See [`docs/scenario-authoring.md`](docs/scenario-authoring.md) for the
full schema, CLI workflow, and diagnostics reference, and
[`templates/SCENARIO_STARTER.json`](templates/SCENARIO_STARTER.json) for a
minimal starting point.

## Making a code change

1. Open an issue first for anything beyond a small, obvious fix — this
   project follows a milestone/workpack model (`workpacks/*.md`,
   `02_MILESTONE_ROADMAP.md`); unsolicited scope drift into a later
   milestone's territory will be asked to split.
2. Add or extend a regression test that fails on the bug or gap before your
   fix, not one that only re-asserts the implementation. Prefer black-box
   tests over the public contract (REST/WS/SDK) and reference-model tests
   (e.g. a naive Dijkstra for route-weight tests) over internals.
3. Run `pnpm verify` locally and fix anything it surfaces.
4. Update `STATUS.md`/`EVIDENCE.md` if you're implementing a tracked
   milestone; for a smaller change, a clear PR description with the exact
   commands you ran and their results is enough.
5. Keep formatting/refactor churn out of functional-change diffs.

## Reporting a defect

If it's a security or information-boundary issue (a way to observe truth
from a player-facing surface, bypass session scoping, or otherwise break an
invariant above), follow [`SECURITY.md`](SECURITY.md) instead of a public
issue.

For anything else, open a GitHub issue with:

- the exact command(s) you ran and their exit code/output;
- expected vs. actual behavior;
- scenario id, seed, and session id if relevant (all runs are deterministic
  and reproducible from these three values).

## Code style

- TypeScript strict mode stays on; do not add a cast to bypass a type error
  without an inline comment explaining why it is sound.
- Runtime boundaries (HTTP bodies, WS messages, scenario JSON) are validated
  with `zod` schemas, not just TypeScript types.
- `pnpm lint` (ESLint + `typescript-eslint`) must be clean.
- Prefer explicit domain names (`districtId`, `claimId`, `tick`) over
  generic ones (`id`, `n`).

## Pull requests

Use the PR template. CI (`.github/workflows/ci.yml`) runs lint, typecheck,
build, the full test suite, determinism/invariant checks, package/tarball
smoke, a Command Center smoke flow, and a Docker packaging smoke job. None of
the required jobs are allowed to use `continue-on-error`; a red required job
blocks merge.

# ADR — M7 Public Repository and Release Engineering

## Status

Implemented for M7, awaiting owner acceptance.

## Context

M0–M6 left a working, verified monorepo (`pnpm verify` green, 345 tests
across 10 packages, 3 distinct scenarios) but nothing an outside developer
could evaluate without already knowing the codebase: no README, no license
file matching the declared `"license": "MIT"` in `package.json`, no CI, no
Docker/packaging path, and no protocol/architecture/threat-model docs
written for someone who isn't the implementer. `workpacks/M7-public-release.md`
requires exactly this "survive first contact with an outside developer"
outcome, with an explicit death gate: a fresh clone must be able to
reproduce the documented demo and verification commands.

## Decision

1. **The README is a real product page, not a link index, and every
   quantitative claim in it is copied verbatim from an artifact this
   milestone actually generated.** The benchmark excerpt table is copied
   from `data/benchmark-smoke/report.md` (produced by `pnpm verify:benchmark`
   during this milestone's own verification run, see `EVIDENCE.md`), not
   hand-written or estimated. The two screenshots
   (`data/evidence/m3-command-center-*.png`) are the same M3 screenshots
   already in the repo — no new fabricated or staged image was created.
   The "what this repository may claim" paragraph is quoted verbatim from
   `00_NORTH_STAR.md`'s "Release claim" section rather than paraphrased, so
   the honesty rule (`.cursor/rules/40-release-honesty.mdc`) has one single
   source of truth for the allowed claim text.

2. **No CI badge, GitHub Actions status shield, or `compare` link was added
   anywhere.** This working tree has no `.git` directory and no hosting
   remote (confirmed: `git status` → `fatal: not a git repository`). A
   shields.io/GitHub Actions badge pointing at a repository that doesn't
   exist yet would be unverifiable and is exactly the kind of
   non-reproducible claim `40-release-honesty.mdc` forbids. `CHANGELOG.md`
   and `CITATION.cff` both carry an explicit inline note that their
   GitHub-URL fields are placeholders pending real hosting, instead of
   silently shipping a URL that 404s.

3. **`pnpm verify` gained exactly one new gate (`verify:tarball-smoke`) and
   nothing else in the chain changed order or behavior.** Every
   publishable package (`contracts`, `epistemics`, `scenario-schema`,
   `simulation`, `server`, `sdk`, `benchmark`, `mcp-server`,
   `test-fixtures`) now declares `"files": ["dist"]`, which only affects
   `npm pack`/`pnpm pack` output — it has no effect on `tsc`, `vitest`, or
   any existing build/test/CLI path, confirmed by the full `pnpm verify`
   re-run in this milestone producing byte-identical test counts and
   benchmark scores to M6's own `EVIDENCE.md` (345 tests, same 9
   benchmark-matrix scores). `scripts/verify-tarball-smoke.mjs` proves
   "built exports only" packaging is real, not just declared: it runs a
   genuine `npm pack` on two packages, extracts each tarball with `tar`
   (no network), and lets `@null-city/epistemics`'s own compiled
   `dist/store.js` resolve its bare-specifier `import ... from
   "@null-city/contracts"` against a scratch `node_modules` tree seeded
   only from the two packed tarballs plus one dereferenced copy of `zod` —
   a real consumer-shaped resolution, not a relative-path shortcut. Network
   access to the npm registry was deliberately avoided (verified reachable
   in this environment, but not relied upon) so this gate can't become
   flaky on a disconnected CI runner or contributor machine.

4. **Docker is CI-only/optional by construction, not just by intent.**
   `pnpm verify` never shells out to `docker`. A separate,
   non-`pnpm verify` script (`scripts/verify-docker-smoke.mjs`,
   `pnpm verify:docker`) builds the `Dockerfile`, brings up
   `docker-compose.yml`'s two services, drives one real scenario session
   through the containerized server's REST surface, checks the
   containerized Command Center bundle is served, and tears down — but it
   detects an unreachable Docker daemon up front and fails with an
   explicit, actionable message rather than hanging or corrupting
   `pnpm verify`'s exit code. This was exercised directly in this
   milestone: the sandboxed dev environment has the `docker` CLI and
   compose plugin but no running daemon (`docker info` fails, no Docker
   Desktop process, no `Docker Desktop.exe` installed), so
   `verify-docker-smoke.mjs` was confirmed to fail fast and cleanly
   (`FAIL docker-smoke: no reachable Docker daemon ... This gate is
   CI-only/optional locally.`, exit 1) exactly as designed, while
   `docker compose config` (pure YAML/schema validation, no daemon needed)
   confirmed `docker-compose.yml` itself parses and resolves correctly.
   `.github/workflows/ci.yml`'s `docker-smoke` job runs the same script on
   GitHub's `ubuntu-latest`, where a Docker daemon is always available, and
   is a required job with no `continue-on-error`.

5. **One CI step is explicitly, visibly non-required: dependency review.**
   `pnpm audit --prod` runs in CI with `continue-on-error: true`, labeled
   "(informational; not a required gate)" in the step name — this is the
   one intentional use of `continue-on-error` in the whole workflow, and it
   is not silent: `03_RELEASE_GATE.md`'s row D ("Dependency review") asks
   for "lockfile audit plus documented accepted findings", not a hard
   block on every transitive advisory. Running it during this milestone
   found 3 moderate `react-router`/`react-router-dom` advisories (open
   redirect / arbitrary constructor injection), all reachable only through
   `apps/command-center`'s client-side routing. These are documented as an
   **accepted finding** in `docs/threat-model.md` §9 with the specific
   reason they don't apply to this app's actual usage (hardcoded local
   routes in `App.tsx`, no SSR, no attacker-controlled redirect target) —
   not silently ignored, and not force-fixed by bumping a major dependency
   version outside this milestone's scope (`AGENTS.md`'s "no opportunistic
   refactor").

6. **The release archive script only ever packages source, never a build
   output, and is not part of `pnpm verify`.** `scripts/release-archive.mjs`
   (`pnpm release:archive`) `tar czf`s the repository excluding
   `node_modules`, `dist`, `build`, `.tsbuildinfo`, `.git`, and its own
   prior output (`data/release/`), then writes a SHA-256 checksum file next
   to the archive. This was run during this milestone
   (`data/release/null-city-v0.1.0.tar.gz`, 2,147,977 bytes,
   sha256=`086ba970d45e276763152c16c005549c6660b02bdbc39cb98238bcbfb405e9e5`)
   and manually spot-checked with `tar -tzf` to confirm no `node_modules`
   or `dist` path leaked in. It intentionally does not require a build
   first (source, not build output, is the reproducibility unit for this
   archive) and `data/release/` is added to `.gitignore` so a regenerated
   archive is never accidentally committed as a stale binary blob.

7. **`docs/scenario-authoring.md` and `docs/scoring.md` (already present
   from M6/M2) were left as-is; four new docs were added instead of
   editing them.** The workpack's doc list (architecture, protocol,
   scenario authoring, benchmark, threat-model) maps onto two already-good
   M6 docs plus four gaps: `docs/architecture.md` (new — package map,
   dependency rules, kernel phases, contract split, packaging, all
   cross-referenced to real file paths, superseding the *target* design in
   `01_TARGET_ARCHITECTURE.md` with what's actually shipped),
   `docs/protocol.md` (new — full REST/WS reference written directly from
   `packages/server/src/{http,rpc,ws}.ts` and `packages/contracts/src/{public,commands}.ts`,
   for someone building a client without the SDK), `docs/benchmark.md`
   (new — outside-in "how to read a report" companion to
   `packages/benchmark/README.md`'s package-level API reference, including
   the same real benchmark excerpt used in the README), and
   `docs/threat-model.md` (new — assets/trust-boundaries/attacks/mitigations
   table, each row backed by a named test file, plus the dependency-review
   finding from decision 5).

## Alternatives considered

- **Add a GitHub Actions status badge with a placeholder/example org name.**
  Rejected: even clearly labeled as a placeholder, a live-looking badge
  invites copy-paste into a real fork without updating it, and
  `40-release-honesty.mdc` asks for reproducibility from the current
  commit, not "reproducible once someone else finishes hosting it."
- **Make the Docker smoke job part of `pnpm verify` and skip it when no
  daemon is reachable.** Rejected: a verification command that silently
  skips a gate depending on local machine state is exactly the
  "NOT_RUN reported as PASS" failure mode `AGENTS.md` forbids; keeping
  Docker as a separate, explicitly-invoked script with its own honest
  failure message, wired into CI as its own required job, is more honest
  than a soft-skip inside `pnpm verify`.
- **Use a real `npm install <tarball>` (network) for the tarball smoke
  test instead of the scratch-`node_modules` technique.** Rejected as the
  default/required check: it would make `pnpm verify` depend on npm
  registry reachability, which is unrelated to what the check is actually
  proving (packaging correctness) and is exactly the kind of environmental
  dependency the milestone's "stays green without Docker if Docker
  unavailable" instruction is warning against generalizing from.
- **Bump `react-router-dom` to a patched major version to clear the `pnpm
  audit` findings outright.** Rejected for this milestone: it is a
  dependency/API surface change to `apps/command-center` (M3's vertical
  slice) with no direct M7 acceptance-criterion dependency, i.e. scope
  drift under `AGENTS.md`'s "no opportunistic refactor" rule; documented as
  an accepted, reasoned finding instead (decision 5).

## Consequences

- A fresh clone can now go from `pnpm install && pnpm build && pnpm demo`
  to a running browser demo, or `docker compose up --build` to the same
  demo containerized, using only the README.
- `pnpm verify`'s runtime grew by the tarball-smoke step (a few seconds;
  no network) but is otherwise unchanged in gate count/order relative to
  M6, and produced byte-identical test/benchmark results to M6's own
  `EVIDENCE.md` run.
- The one open, honestly-documented risk from this milestone is the
  accepted `react-router`/`react-router-dom` dependency finding (decision
  5) — a future milestone or a dedicated PR should still take up the
  version bump even though it is out of scope here.
- Docker packaging itself (image actually starts, health-checks, and
  serves both services end-to-end) is **verified by static/schema means
  only in this environment** (`docker compose config`, manual Dockerfile
  review) — it was not executed against a live daemon here because none is
  installed in this sandbox. This is recorded as `BLOCKED` (environment
  limitation, not a defect) in `EVIDENCE.md`/`STATUS.md`; the CI
  `docker-smoke` job is the actual gate once this repository has a CI
  runner.

## Verification

See `EVIDENCE.md` for exact commands, exit codes, and output for: the full
`pnpm verify` re-run (including the new `verify:tarball-smoke` gate), the
Command Center e2e smoke script, `pnpm release:archive`, `pnpm audit --prod`,
`docker compose config`, and the deliberate `verify-docker-smoke.mjs`
no-daemon failure-path check.

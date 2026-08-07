# EVIDENCE — NullCity M10.1.2 Projection-Safe Parser Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200) + GitHub Actions `ubuntu-latest`
- pnpm 10.33.0 / Node 20 (CI)
- Date: 2026-08-07
- Remote: https://github.com/taipei49314/null-city
- PR: https://github.com/taipei49314/null-city/pull/1

## Exact commit (release/m10.1.2 tip; merge target)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | `7c50413df69a16dc1b17b323a7424f57e294fc50` |
| `git rev-parse 'HEAD^{tree}'` | _(filled after checkout of this commit)_ |
| `git status --short` | clean |

## Local gates (pre-push)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | |
| 2 | `pnpm verify` | **0** | |
| 3 | `pnpm command-center:e2e` | **0** | |
| 4 | `pnpm verify:markdown-links` | **0** | |
| 5 | `pnpm verify:no-external-workpack` | **0** | |
| 6 | `pnpm verify:release-archive` | **0** | |

## Fresh clone (pre-push, `_audit/` deleted)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1–5 | install / verify / e2e / release-archive | **0** | Self-contained |

## Remote CI (required checks)

| Check | Conclusion | URL |
|---|---|---|
| Workflow run | **success** | https://github.com/taipei49314/null-city/actions/runs/31182059542 |
| Lint, typecheck, build, tests, determinism, package/tarball smoke (`verify`) | **success** | https://github.com/taipei49314/null-city/actions/runs/31182059542/job/92877473625 |
| Docker build + compose smoke (required) (`docker-smoke`) | **success** | https://github.com/taipei49314/null-city/actions/runs/31182059542/job/92878166312 |

Branch protection on `main` requires both contexts above (`strict: true`, `enforce_admins: true`).

## Finding → test mapping

| Finding | Regression |
|---|---|
| Resealed `SystemStateChanged.teams = [{}, {}]` | `rejects fully resealed malformed SystemStateChanged teams and routes before projection` |
| Resealed `SystemStateChanged.routes = { forged: null }` | same |
| `ScenarioStarted.districts = [{}]` | `rejects nested truth/player values that only satisfy the outer container shape` |
| `ScenarioCompleted.finalScore.breakdown = [{}]` | same |
| `ClaimUpdated.claim.evidenceIds = [{}]` | same |
| Projector throw → blank page | `ReplayLabPage` unified `projectionFailure` fatal UI |

## Tag

| Field | Value |
|---|---|
| Tag | `v0.1.0-alpha.1` |
| Points at | exact merged `main` tip after PR #1 |
| Notes | filled after merge |

## Remote gates

| Gate | Status |
|---|---|
| GitHub Actions verify | **PASS** (run 31182059542) |
| Docker smoke | **PASS** (run 31182059542) |

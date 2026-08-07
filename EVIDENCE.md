# EVIDENCE — NullCity M10.1.2 Projection-Safe Parser Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200) + GitHub Actions `ubuntu-latest`
- pnpm 10.33.0 / Node 20 (CI)
- Date: 2026-08-07
- Remote: https://github.com/taipei49314/null-city
- PR: https://github.com/taipei49314/null-city/pull/1 (merged via rebase)

## Exact merged commit (`main` tip tagged `v0.1.0-alpha.1`)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | `cb80e31575ff895a6f6f8ea780aa65495fa487d9` |
| `git rev-parse 'HEAD^{tree}'` | `c0f4e59972e020e95683752703dc57bdfe2b7627` |
| `git status --short` | clean |
| Tag | `v0.1.0-alpha.1` → `cb80e31575ff895a6f6f8ea780aa65495fa487d9` |

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

## Remote CI (required checks on PR #1)

Latest green PR tip before rebase merge (same tree as tagged commit):

| Check | Conclusion | URL |
|---|---|---|
| Workflow run | **success** | https://github.com/taipei49314/null-city/actions/runs/31182426759 |
| `verify` — Lint, typecheck, build, tests, determinism, package/tarball smoke | **success** | https://github.com/taipei49314/null-city/actions/runs/31182426759/job/92878685048 |
| `docker-smoke` — Docker build + compose smoke (required) | **success** | https://github.com/taipei49314/null-city/actions/runs/31182426759/job/92879408595 |

Prior green run on the previous tip:

| Check | Conclusion | URL |
|---|---|---|
| Workflow run | **success** | https://github.com/taipei49314/null-city/actions/runs/31182059542 |

Branch protection on `main`: required status checks = both contexts above (`strict: true`, `enforce_admins: true`).

## Finding → test mapping

| Finding | Regression |
|---|---|
| Resealed `SystemStateChanged.teams = [{}, {}]` | `rejects fully resealed malformed SystemStateChanged teams and routes before projection` |
| Resealed `SystemStateChanged.routes = { forged: null }` | same |
| `ScenarioStarted.districts = [{}]` | `rejects nested truth/player values that only satisfy the outer container shape` |
| `ScenarioCompleted.finalScore.breakdown = [{}]` | same |
| `ClaimUpdated.claim.evidenceIds = [{}]` | same |
| Projector throw → blank page | `ReplayLabPage` unified `projectionFailure` fatal UI |

## Release archive / Desktop zip (local allowlist)

| Field | Value |
|---|---|
| Archive | `null-city-m10.1.2-projection-safe.zip` |
| SHA-256 | `b34910a8a5dcb7ed922d38c3e05e93076786e77483da19f0b2e67f8d85f7bf34` |
| File count | 383 |

## Remote gates

| Gate | Status |
|---|---|
| GitHub Actions verify | **PASS** (run 31182426759) |
| Docker smoke | **PASS** (run 31182426759) |
| Tag `v0.1.0-alpha.1` | **PASS** on `cb80e31575ff895a6f6f8ea780aa65495fa487d9` |

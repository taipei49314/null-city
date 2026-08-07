# EVIDENCE — NullCity M10.1.2 Projection-Safe Parser Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200)
- pnpm 10.33.0
- Date: 2026-08-07
- Audit pack: `_audit/m10.1.2/` (from `nullcity-cursor-m10.1.2-projection-safe-pack`)

## Exact commit (filled after freeze)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | _pending_ |
| `git rev-parse 'HEAD^{tree}'` | _pending_ |
| `git status --short` | _pending_ |

## Local gates

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | pending | |
| 2 | `pnpm verify` | pending | |
| 3 | `pnpm command-center:e2e` | pending | |
| 4 | `pnpm verify:markdown-links` | pending | |
| 5 | `pnpm verify:no-external-workpack` | pending | |
| 6 | `pnpm verify:release-archive` | pending | |

## Fresh clone

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | clone exact commit; delete `_audit/` | pending | |
| 2 | `pnpm install --frozen-lockfile` | pending | |
| 3 | `pnpm verify` | pending | |
| 4 | `pnpm command-center:e2e` | pending | |
| 5 | `pnpm verify:release-archive` | pending | |

## Finding → test mapping

| Finding | Regression |
|---|---|
| Resealed `SystemStateChanged.teams = [{}, {}]` | `rejects fully resealed malformed SystemStateChanged teams and routes before projection` |
| Resealed `SystemStateChanged.routes = { forged: null }` | same |
| `ScenarioStarted.districts = [{}]` | `rejects nested truth/player values that only satisfy the outer container shape` |
| `ScenarioCompleted.finalScore.breakdown = [{}]` | same |
| `ClaimUpdated.claim.evidenceIds = [{}]` | same |
| Projector throw → blank page | `ReplayLabPage` `projectionFailure` fatal UI |

## Release archive

| Field | Value |
|---|---|
| SHA-256 | pending |
| Entry count | pending |

## Remote gates

| Gate | Status |
|---|---|
| GitHub Actions verify | **BLOCKED** (no remote) |
| Docker smoke | **BLOCKED** (no remote) |

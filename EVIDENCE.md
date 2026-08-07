# EVIDENCE — NullCity M10.1.2 Projection-Safe Parser Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200)
- pnpm 10.33.0
- Date: 2026-08-07
- Audit pack: `_audit/m10.1.2/nullcity-cursor-m10.1.2-projection-safe-pack/`

## Exact commit (verified source)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | `30a1aec04b0847c343bd79aacb9a5d7cca54611b` |
| `git rev-parse 'HEAD^{tree}'` | `88f73e13dc0f6d1d790017224649e6b280c53420` |
| `git status --short` at gate time | clean before evidence/report refresh |

## Local gates (on `30a1aec`)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | |
| 2 | `pnpm verify` | **0** | Full suite green |
| 3 | `pnpm command-center:e2e` | **0** | |
| 4 | `pnpm verify:markdown-links` | **0** | |
| 5 | `pnpm verify:no-external-workpack` | **0** | |
| 6 | `pnpm verify:release-archive` | **0** | |

## Fresh clone (on `30a1aec`, `_audit/` deleted)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | clone + delete `_audit/` | **0** | `has_audit=False` |
| 2 | `pnpm install --frozen-lockfile` | **0** | |
| 3 | `pnpm verify` | **0** | |
| 4 | `pnpm command-center:e2e` | **0** | |
| 5 | `pnpm verify:release-archive` | **0** | |

## Finding → test mapping

| Finding | Regression |
|---|---|
| Resealed `SystemStateChanged.teams = [{}, {}]` | `rejects fully resealed malformed SystemStateChanged teams and routes before projection` |
| Resealed `SystemStateChanged.routes = { forged: null }` | same |
| `ScenarioStarted.districts = [{}]` | `rejects nested truth/player values that only satisfy the outer container shape` |
| `ScenarioCompleted.finalScore.breakdown = [{}]` | same |
| `ClaimUpdated.claim.evidenceIds = [{}]` | same |
| Projector throw → blank page | `ReplayLabPage` unified `projectionFailure` fatal UI |

## Diff summary (product)

- `apps/command-center/src/replay/event-payloads.ts` — nested truth team/route validators + schema parity
- `apps/command-center/src/routes/ReplayLabPage.tsx` — projector exceptions → visible fatal rejection
- `apps/command-center/test/replay-verify-m10.1.1.test.ts` — fully resealed nested regressions

## Release archive / Desktop zip

| Field | Value |
|---|---|
| Archive | `null-city-m10.1.2-projection-safe.zip` |
| Desktop | `C:\Users\G713RW\Desktop\null-city-m10.1.2-projection-safe.zip` |
| SHA-256 | `b34910a8a5dcb7ed922d38c3e05e93076786e77483da19f0b2e67f8d85f7bf34` |
| File count | 383 |

## Remote gates

| Gate | Status |
|---|---|
| GitHub Actions verify | **BLOCKED** (no `git remote`) |
| Docker smoke | **BLOCKED** (no `git remote`) |

# EVIDENCE — NullCity M10.1.1 Final Pre-Push Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200)
- pnpm 10.33.0 / Node workspace engines ≥20
- Date: 2026-08-07
- Audit pack: `_audit/m10.1.1/` (from `nullcity-cursor-m10.1.1-final-closure-pack-v2`)

## Exact commit (product freeze)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | _filled after freeze commit_ |
| `git rev-parse 'HEAD^{tree}'` | _filled after freeze commit_ |
| `git status --short` | _must be clean_ |

## Local gates

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | pending | |
| 2 | `pnpm verify` | pending | includes markdown-links, no-external-workpack, release-archive, adversarial |
| 3 | `pnpm command-center:e2e` | pending | |
| 4 | `pnpm verify:markdown-links` | pending | |
| 5 | `pnpm verify:release-archive` | pending | |

## Fresh clone (no `_audit/` required)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | clone exact commit → empty dir | pending | |
| 2 | delete `_audit/` if present | pending | |
| 3 | `pnpm install --frozen-lockfile` | pending | |
| 4 | `pnpm verify` | pending | |
| 5 | `pnpm command-center:e2e` | pending | |

## Adversarial before → after (browser)

| Case | Before (M10.1 audit) | After (M10.1.1) |
|---|---|---|
| Resealed `CommandResult` state rewrite | semantic green / UI PASS risk | `status=FAIL`, semantic FAIL |
| Delete one / all player `CommandResult` | semantic green | `status=FAIL` |
| Duplicate player `CommandResult` | semantic green | `status=FAIL` |
| Foreign player session ID | semantic green | `status=FAIL` |
| Forged `activeIncidents` | semantic green | `status=FAIL` |
| Forged `RunCompleted` counts | semantic green | `status=FAIL` |
| Erased ledger / forged protocol / scenario digest | implied by broad semantic PASS | scopes explicitly `NOT_CHECKED` |
| `EvidenceRecorded` `{}` | PARTIAL then provenance crash | parse reject / never projected |
| Deep nested payload | stack overflow | controlled depth error |

## Release archive

| Field | Value |
|---|---|
| Selection includes M10.1 test + fixture | pending |
| No `_audit/` in archive | pending |
| SHA-256 | pending |
| File count | pending |

## Remote gates

| Gate | Status |
|---|---|
| Push / GitHub Actions verify | **BLOCKED** (no git remote) |
| Docker smoke workflow | **BLOCKED** (no git remote) |

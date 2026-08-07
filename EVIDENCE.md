# EVIDENCE — NullCity M10.1.1 Final Pre-Push Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200)
- pnpm 10.33.0 / Node workspace engines ≥20
- Date: 2026-08-07
- Audit pack: `_audit/m10.1.1/` (from `nullcity-cursor-m10.1.1-final-closure-pack-v2`)

## Exact commit (verified source)

| Field | Value |
|---|---|
| `git rev-parse HEAD` | `e22d31a87751404ccaa0b73347d94ea3761c31f2` |
| `git rev-parse 'HEAD^{tree}'` | `38de8f623e5035369e964a56f09d15491bbe9234` |
| `git status --short` at gate time | clean before evidence/report refresh commit |

## Local gates (on `e22d31a`)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | Lockfile up to date |
| 2 | `pnpm verify` | **0** | Full gate green incl. no-external-workpack + release-archive + adversarial |
| 3 | `pnpm command-center:e2e` | **0** | Smoke PASS |
| 4 | `pnpm verify:markdown-links` | **0** | (inside #2) |
| 5 | `pnpm verify:release-archive` | **0** | (inside #2) test+fixture packaged; no `_audit/` |

## Fresh clone (on `e22d31a`, `_audit/` deleted)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `git clone` exact commit → empty temp dir | **0** | |
| 2 | `Remove-Item -Recurse _audit` | **0** | `has_audit=False` |
| 3 | `pnpm install --frozen-lockfile` | **0** | |
| 4 | `pnpm verify` | **0** | Self-contained; M10.1 fixtures load without `_audit/` |
| 5 | `pnpm command-center:e2e` | **0** | |

## Adversarial before → after (browser)

| Case | Before (M10.1 audit) | After (M10.1.1) |
|---|---|---|
| Resealed `CommandResult` state rewrite | semantic green / UI PASS risk | `status=FAIL` |
| Delete one / all player `CommandResult` | semantic green | `status=FAIL` |
| Duplicate player `CommandResult` | semantic green | `status=FAIL` |
| Foreign player session ID | semantic green | `status=FAIL` |
| Forged `activeIncidents` | semantic green | `status=FAIL` |
| Forged `RunCompleted` counts | semantic green | `status=FAIL` |
| Erased ledger / forged protocol / scenario digest | implied by broad semantic PASS | scopes explicitly `NOT_CHECKED` |
| `EvidenceRecorded` `{}` | PARTIAL then provenance crash | parse reject / never projected |
| Deep nested payload | stack overflow | controlled depth error |

Regression file: `apps/command-center/test/replay-verify-m10.1.1.test.ts`

## Release archive / Desktop zip

| Field | Value |
|---|---|
| Archive | `null-city-m10.1.1-final-closure.zip` |
| Desktop | `C:\Users\G713RW\Desktop\null-city-m10.1.1-final-closure.zip` |
| SHA-256 | `41abb500f828a456dab72ee491689f53980965b061b9a03ff6cffb9eed2d1cc1` |
| File count | 383 (git allowlist) |
| M10.1 test + fixture packaged | yes |
| `_audit/` in archive | no |

## Remote gates

| Gate | Status |
|---|---|
| Push / GitHub Actions verify | **BLOCKED** — no `git remote` configured |
| Docker smoke workflow | **BLOCKED** — requires push to GitHub Actions |

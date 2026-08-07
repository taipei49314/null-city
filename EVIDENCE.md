# EVIDENCE — NullCity M10.1 Pre-Push Closure

## Environment

- OS: Microsoft Windows 11 (win32 10.0.26200)
- pnpm 10.33.0 / Node (workspace `engines.node` ≥20)
- Date: 2026-08-07
- Audit pack: `_audit/m10.1/` (from `nullcity-cursor-m10.1-prepush-fix-pack`)

## Freeze commands (local)

| # | Command | Exit | Result |
|---:|---|---:|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | Lockfile up to date |
| 2 | `pnpm verify` | **0** | Full gate green, incl. `verify:markdown-links` + release-archive canary + M10 audit-repro + 91-attack adversarial |
| 3 | `pnpm command-center:e2e` | **0** | Smoke flow PASS; artifact blocked pre-completion; released post-completion |
| 4 | `pnpm verify:benchmark` (inside #2) | 0 | 15 runs (5 scenarios × 3 policies) → `data/benchmark-smoke/report.md` |
| 5 | Adversarial suite (inside #2) | 0 | 91 attacks, 89 defended, 0 vulnerable, 2 accepted limitations |

## Browser verifier (M10.1 P0)

| Check | Result |
|---|---|
| Honest sample fixture | `status=PARTIAL`, integrity+semantics PASS; truth/player replay NOT RUN |
| Resealed player `CommandResult` rewrite | semantic FAIL (`test/replay-verify-m10.1.test.ts`) |
| Minimal forgery fixture (`_audit/m10.1/reproduction/…`) | rejected (parse or verify FAIL) |
| UI / Markdown report | PARTIAL badge; Integrity / Semantic bindings lines; no unqualified full PASS |

## Exact commit

| Field | Value |
|---|---|
| `git rev-parse HEAD` | `ce9a013522107880b735e896eaf4a3ac69a8cba2` |
| `git rev-parse 'HEAD^{tree}'` | `ce6c0611091d6f5edb3c84613cae64de87b134ef` |
| `git status --short` (at evidence freeze) | clean (empty) |

Note: this EVIDENCE SHA table documents the initial product commit above. A follow-up commit may only refresh this evidence file.

## Not executed / BLOCKED

| Gate | Status |
|---|---|
| Docker compose loopback smoke | **BLOCKED** (not run this round) |
| Push to remote | **BLOCKED** (no remote / not requested) |
| Remote CI | **BLOCKED** (requires push) |
| Fresh clone from remote | **BLOCKED** (requires push) |

## Packaging note

Release allowlist now ships selected public `data/` assets (`data/evidence/**`, benchmark-smoke reports, `data/m4-run-*.artifact.json`) and root governance files (`02_MILESTONE_ROADMAP.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`). `data/release/**` remains denied.

## Prior ADR / matrix

- `docs/decisions/2026-08-07-m10-integrity-closure.md`
- `docs/audits/2026-08-07-m10-findings-matrix.md`

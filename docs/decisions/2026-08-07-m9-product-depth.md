# ADR — M9 Product Depth

## Status

Accepted for the post-audit integrity tree.

## Decision

1. Default Command Center locale is `zh-TW`, with an `en` toggle persisted in `localStorage`. Brand name remains `NULL CITY`.
2. After-action debriefs are deterministic Markdown derived from run artifacts + evidence provenance — no LLM, no invented scores.
3. Mirror District joins the suite as a fourth scenario emphasizing twin contradictory reports and verification-before-commit.
4. External-audit critical reproductions are gated via `pnpm verify:audit-repro` so the P0 resume/artifact failures cannot silently regress.
5. Release tagging remains **NOT READY** until Docker smoke + CI + independent re-review land; M9 does not overturn that honesty.

## Consequences

- Benchmark matrix and golden receipts expand to four scenarios.
- Command Center topology registry grows by one structural module.

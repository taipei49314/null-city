# M9 Workpack — Product Depth & Release Hardening

## Objective

Make NullCity feel like a living crisis-command product while closing release-gate gaps that can be closed without a remote CI runner.

## Shipped in this push

- Traditional Chinese default UI (`zh-TW` / `en` toggle) on Launch + Replay Lab labels
- After-action **戰後簡報** export from Replay Lab (heuristic, no LLM)
- Fourth scenario **Mirror District** (twin false-attribution / verify-before-commit)
- `pnpm verify:audit-repro` — external-audit critical cases against current code
- Git repository initialized for tracked-file release archives

## Still blocked for tag

- Live Docker smoke (daemon)
- Remote CI execution
- Independent second reviewer re-run of audit reproductions

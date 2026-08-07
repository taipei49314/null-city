# ADR — M10 Integrity Closure (artifact v2 + legacy receipt)

Date: 2026-08-07  
Status: Accepted

## Context

The M9 Red Ledger audit (FAIL — do not tag) showed three release blockers:

1. `verification-first` sent district `target` while the server only bound claims when `claimId` was present.
2. Artifact verify replayed truth but trusted the attacker-supplied player log after reseal.
3. `null-city-run verify` printed undifferentiated PASS without scenario replay; legacy RunReceipt allowed rewritten identity under the same "full verify" language.

## Decision

### Artifact v2

- Bump run artifact to **version 2**.
- Require a canonical `publicActionLedger` (commands + assessments in submission order).
- Full verification rebuilds the player projection from `scenario + seed + ledger` via the same projection path as the live hub, then compares `playerLogHash`, event count, and terminal claim/evidence counts.
- Cross-bind every player `CommandResult` to exactly one truth accepted/rejected outcome.

### Public claim verification

- Public `REQUEST_VERIFICATION` params are `{ teamId, claimId }` only.
- Caller-provided `target` is rejected as a competing source of truth.
- District inspection without a claim uses the separate public/engine command `INSPECT_DISTRICT`.

### CLI honesty

- Default `null-city-run verify` requires compiled scenario replay (`requireReplay: true`).
- `--integrity-only` prints `PARTIAL` and exits `2`.
- Legacy `null-city-verify-receipt` is integrity-only (`PARTIAL`, exit `2`); public users are directed to artifact v2.

### Advance projection

- `session.advance` publishes the player projection after every tick so `OwnTeamUpdated` stamps match event ticks (required for deterministic player rebuild).

## Consequences

- All shipped sample artifacts and CC fixtures must be regenerated as v2.
- Golden engine scripts may keep `{ teamId, target }` for in-process runs; REST drivers translate to `claimId` or `INSPECT_DISTRICT`.
- Tag readiness still depends on CI, Docker daemon smoke, and a committed Git tree — not claimed here.

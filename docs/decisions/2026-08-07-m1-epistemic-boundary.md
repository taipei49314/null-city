# ADR — M1 epistemic boundary

## Status

Accepted for M1.

## Context

M0 blocked raw truth on the transport but still derived player views by masking truth fields. That is not an evidence model.

## Decision

1. Add `@null-city/epistemics` with a dedicated player event store/hash chain and a pure `projectPlayerState` reducer.
2. `TruthToPlayerBridge` translates truth batches into public events. Corruption metadata updates pending content only and is never emitted.
3. Public REST/WS expose `PlayerSessionState` (claims, evidence, assessments, own teams, known routes) rebuilt from player events.
4. `session.assess` records assessments on the player stream. `REQUEST_VERIFICATION` may target a `claimId`.
5. Admin snapshots remain off the player surface.

## Consequences

- Clients must consume claims/evidence rather than district attribute masks.
- Player log hashes differ from truth log hashes by design.
- Full UI claim board is M3; M1 proves the public contract with a CLI player.

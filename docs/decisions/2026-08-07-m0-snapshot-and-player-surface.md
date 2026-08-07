# ADR — M0 snapshot protocol and player surface

## Status

Accepted for M0.

## Context

Inherited P0s showed live snapshot aliasing, missing `chainedCount`, player transport truth leakage, and post-completion mutation.

## Decision

1. Snapshots are protocol v1 detached values including `chainedCount`, `scenarioDigest`, and `protocolVersion`. Resume validates identity bindings before engine construction and deep-clones all state.
2. Player REST/WS returns only an allow-listed event surface. Raw snapshots are forbidden on player HTTP/WS; `admin.snapshot` remains in-process/RPC-only and is not routed on player HTTP.
3. Completed runs reject every command without emitting events or mutating digests/scores.
4. Atomic snapshot save is documented as best-effort rename, not fsync durability.
5. Event verification checks genesis, session, sequence, tick monotonicity, kind allow-list, payload object shape, hash links, and optional terminal root. A hash chain alone is not authenticity.

## Consequences

- Old snapshots without the new fields cannot resume.
- Clients that relied on raw `TrueIncidentOccurred` / `SystemStateChanged` over player transport must use observations and player view instead.
- Full epistemic claim model remains M1.

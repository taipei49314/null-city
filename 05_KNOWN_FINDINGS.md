# Inherited NullCity Findings

These findings came from a prior review of the uploaded alpha. Cursor must reproduce or disprove them under the real project dependencies before closing them.

## P0 — public truth leakage

The player view masks some fields, but raw truth is exposed through event, snapshot, and WebSocket paths. Internal events include incidents and system-state truth before observations are delivered.

Likely locations:

- `packages/server/src/rpc.ts`
- `packages/server/src/ws.ts`
- `packages/server/src/player-view.ts`
- `packages/simulation/src/engine.ts`

Required regression: every player-facing REST/WS response remains free of unobserved incidents, truth attributes, internal queues, raw snapshots, and future schedule data.

## P0 — snapshot/resume divergence and aliasing

A future-output-affecting counter was omitted from snapshot state, snapshots returned a live world reference, resume accepted external objects directly, and server resume lacked identity/scenario binding.

Likely locations:

- `packages/simulation/src/engine.ts`
- `packages/simulation/src/snapshot.ts`
- `packages/server/src/rpc.ts`
- `packages/server/src/hub.ts`

Required regression: detached snapshot bytes do not change when the original engine advances; arbitrary-tick resume after chained incidents produces byte-identical final logs and digests; mismatched session/seed/scenario digest is rejected before engine construction.

## P0 — mutation after completion

`submitCommand()` accepted commands after `phase=completed`, changing world state, score, event count, and terminal hash without a new completion receipt.

Likely location:

- `packages/simulation/src/engine.ts`

Required regression: every command and assessment after completion returns a stable rejection and causes zero mutation.

## P1 — weighted path algorithm

The route search behaved like BFS on a weighted graph and could return a slower path.

Likely location:

- `packages/simulation/src/graph.ts`

## P1 — event-chain verifier under-validates

The verifier accepted arbitrary first anchors, sequence gaps, cross-session events, tick rollback, and potentially malformed event payloads as long as hashes were recomputed.

Likely location:

- `packages/contracts/src/canonical.ts`

## P1 — WebSocket session scoping

A socket connected to session A could supply session B in RPC params. Malformed URL encoding and JSON `null` also lacked robust handling; payload/advance bounds were weak.

Likely location:

- `packages/server/src/ws.ts`

## P1 — scenario schema lacks semantic compilation

Missing checks included uniqueness, references, chain cycles, supported version, corruption probability totals, and resource ceilings.

Likely locations:

- `packages/scenario-schema/src/index.ts`
- `packages/simulation/src/world.ts`

## P1 — player view still over-reveals

A delivered observation or dispatched team could unlock all current truth attributes for a district. Verification operated at district/incident granularity rather than claim granularity.

Likely location:

- `packages/server/src/player-view.ts`

This belongs primarily to M1, but M0 must ensure no raw bypass remains.

## P1 — scoring semantics

Decision delay was tracked by district rather than incident, no-action incidents could avoid penalty, dispatch issue time was confused with effective response time, and score field names did not match units.

Likely locations:

- `packages/simulation/src/engine.ts`
- `packages/simulation/src/score.ts`

## P1 — release packaging

The alpha lacked a README, LICENSE file, CI, production start path, and public docs. Package builds emitted `dist` but exports still referenced TypeScript source.

Likely locations:

- root/package manifests
- package manifests
- `apps/`, `docs/`, `.github/`

M0 fixes only the build/export/start pieces needed for its real vertical slice. Full publication work belongs to M7.

## Other inherited risks

- snapshot atomic-save documentation exceeded actual fsync guarantees;
- parsed `null` could produce uncontrolled errors;
- resolved chained incidents could reactivate;
- relative and absolute observation lifecycle differed;
- duration boundaries and route reopen metadata were inconsistent;
- event payload contracts and actual payloads diverged;
- `finalStateDigest()` omitted meaningful state;
- server subscriber exceptions were not isolated;
- scenario cache returned mutable references;
- `session.advance` reported the terminal tick off by one.

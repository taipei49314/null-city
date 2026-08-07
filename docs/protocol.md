# Public protocol reference

This is the reference for `@null-city/server`'s public REST/WS surface —
the same surface `@null-city/sdk`, `@null-city/benchmark`, `@null-city/mcp-server`,
and the Command Center browser app all consume. If you are writing a new
client, this document plus `packages/contracts/src/public.ts` and
`commands.ts` is everything you need; you do not need to read the
simulation kernel.

**No method or route described here ever returns truth.** There is no
authenticated/privileged variant of any of these routes — human and agent
clients share exactly this contract (see `01_TARGET_ARCHITECTURE.md`'s
"Human/agent parity" promise).

## Base URL and transport

- REST: `http://<host>:<port>` (default `http://127.0.0.1:8787` from
  `pnpm server:start`). All bodies are JSON; all responses are
  `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.
- WebSocket: `ws://<host>:<port>/ws/:sessionId` — push events plus an
  in-band RPC channel over the same session.

Source: `packages/server/src/http.ts` (route table), `rpc.ts` (shared
REST+WS operation handlers), `ws.ts` (WS framing).

## REST routes

| Method | Path | Op | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Liveness check; not session-scoped. |
| `POST` | `/sessions` | `session.create` | Create or resume a session. Body: `{ scenarioId, seed?, sessionId?, resume? }`. |
| `GET` | `/sessions` | `session.list` | List active session ids. |
| `GET` | `/sessions/:id/state` | `session.state` | Full `PlayerSessionState` snapshot. |
| `GET` | `/sessions/:id/events?since=<seq>` | `session.events` | Player events with `sequence > since`. |
| `POST` | `/sessions/:id/command` | `session.command` | Submit a command. Body: `{ commandName, params, idempotencyKey }`. |
| `POST` | `/sessions/:id/advance` | `session.advance` | Advance the deterministic clock. Body: `{ ticks }` (clamped 1–540 per call). |
| `POST` | `/sessions/:id/assess` | `session.assess` | Submit a probability/confidence belief. Body: `{ claimId, probability, confidence, rationale? }`. |
| `GET` | `/sessions/:id/summary` | `session.summary` | Terminal run summary. `409 not_completed` before completion. |
| `GET` | `/sessions/:id/artifact` | `session.artifact` | Full run artifact (see below). `409 not_completed` before completion. |
| `DELETE` | `/sessions/:id` | `session.delete` | Remove a session from the in-memory hub. |
| `GET`/any | `/sessions/:id/snapshot` | — | **Always** `403 forbidden` — raw engine snapshots are never on the player transport. |

HTTP status mapping (`packages/server/src/http.ts#rpcRespond`):
`not_found` → 404, `conflict`/`not_completed` → 409, `forbidden` → 403,
`invalid_params`/other → 400.

## WebSocket protocol

Connect to `/ws/:sessionId` (the session must already exist — created via
REST first). Two message shapes, sent by the client:

```jsonc
// Replay events from a given sequence, and get one immediately:
{ "type": "hello", "since": 0 }

// Call the same RPC ops as REST, over the socket:
{ "type": "rpc", "op": "session.command", "requestId": "any-string", "params": { "commandName": "DISPATCH_TEAM", "params": { "teamId": "power-1", "target": "industrial", "task": "power_repair" }, "idempotencyKey": "abc-1" } }
```

Server → client messages:

```jsonc
{ "type": "hello", "sessionId": "...", "stream": "player", "next": 12 }
{ "type": "events", "sessionId": "...", "stream": "player", "events": [ /* PlayerEventEnvelope[] */ ] }
{ "type": "rpc-result", "sessionId": "...", "requestId": "any-string", "ok": true, "result": { /* same shape as the REST op's result */ } }
{ "type": "error", "error": { "code": "...", "message": "..." } }
```

`params.sessionId` in an `"rpc"` message is forced to match the socket's own
`sessionId` (a mismatched value is rejected with `forbidden`); `admin.snapshot`
and `session.snapshot` are rejected the same way as the REST route.

## `PlayerSessionState`

Returned by `session.state`, and embedded in most write responses under
`publicState`/`result.state` (`packages/contracts/src/public.ts`):

```ts
interface PlayerSessionState {
  stream: "player";
  sessionId: string;
  scenarioId: string;
  tick: number;
  phase: "running" | "completed";
  claims: Claim[];
  evidence: Evidence[];
  assessments: Assessment[];
  teams: OwnTeamState[];
  routes: KnownRouteState[];
  resources: { backupGenerators: number; advisoryUses: number };
  score: { total: number; recent: Array<{ category: string; delta: number; reason: string; tick: number }> };
  playerEventCount: number;
  playerLogHash: string;
}
```

`Claim.status` is one of `reported | corroborated | contested | verified |
refuted | stale`; every `Claim`/`Evidence` carries `firstObservedTick`/
`observedTick`/`deliveredTick` so a client can show "as of tick N", not a
live truth value.

## Player event stream

`PlayerEventEnvelope<T>` (`stream: "player"`) is hash-chained
(`previousHash`/`hash`) and sequence-numbered per session, independent of
the truth stream. `kind` is one of:

`SessionStarted`, `EvidenceRecorded`, `ClaimUpdated`, `AssessmentSubmitted`,
`VerificationResolved`, `CommandResult`, `OwnTeamUpdated`,
`KnownRouteUpdated`, `PublicScoreChanged`, `ResourcesChanged`,
`RunCompleted` — each with its own payload type in
`packages/contracts/src/public.ts`. `PublicScoreChangedPayload.category`
matches `docs/scoring.md`'s metric ids (`population_risk`, `infrastructure`,
`events_handled`, `events_missed`, `chain_failure`, `wasted_dispatch`,
`misadvisory`, `decision_delay`, `resource_efficiency`) verbatim — this is
how `@null-city/benchmark`'s metrics are recomputable from the public
stream alone, with no access to truth-side raw values.

## Commands

`CommandName` (`packages/contracts/src/commands.ts`):

| Command | Params | Notes |
|---|---|---|
| `DISPATCH_TEAM` | `{ teamId, target, task }` | |
| `REROUTE_POWER` | `{ from, to }` | |
| `ACTIVATE_BACKUP_GENERATOR` | `{ district }` | Consumes a `resources.backupGenerators` unit. |
| `CLOSE_ROUTE` / `REOPEN_ROUTE` | `{ route }` | |
| `REQUEST_VERIFICATION` | `{ target, teamId }` or `{ claimId, teamId }` | The server resolves a `claimId` to its claim's `districtId` as `target` before validation. |
| `ISSUE_PUBLIC_ADVISORY` | `{ district, text, severity }` | `severity`: `info \| warning \| evacuation`. Consumes a `resources.advisoryUses` unit. |
| `PRIORITIZE_COMMUNICATION` | `{ district, ticks }` | |
| `CANCEL_ORDER` | `{ orderId, reason }` | |

Every command requires a caller-supplied `idempotencyKey`. A retried
submission with the same key is rejected as `duplicate_command` rather than
re-executed — the SDK surfaces this as `outcome.deduplicated === true`
(see `packages/sdk/README.md`), never as a silent double-execution.
`advance` and `assess` have no dedup key and are never safe to blindly
retry (a duplicate `advance` would double-count ticks; a duplicate `assess`
would record a belief twice).

## Completion and the run artifact

While `phase === "running"`, `session.summary` and `session.artifact` both
reject with `not_completed` (409) — no early truth bundle, no fabricated
result. Once `phase === "completed"`:

- `session.summary` returns a small public digest: `finalTick`,
  `scoreTotal`, claim/evidence/assessment counts, `playerLogHash`, claims.
- `session.artifact` (`packages/server/src/artifact.ts#buildSessionArtifact`)
  returns the full `{ format: "null-city-run-artifact", identity, truth: { events, hash }, player: { events, hash }, artifactHash, ... }` bundle
  Replay Lab consumes — this is the one point in the protocol where truth
  events are ever exposed, and only for a run that is already immutable.

Every write after completion (`command`, `advance`, `assess`) is rejected
(`run_completed`); a completed run cannot be mutated by any request.

## Integrity terminology

`playerLogHash`/`artifactHash`/`RunReceipt.receiptHash` are SHA-256 hash
chains: they prove a log was not altered after the fact (tamper-evidence),
assuming you trust the hash you are comparing against. They are **not**
cryptographic signatures and prove nothing about *who* produced a log
unless a `signature` block (optional, `01_TARGET_ARCHITECTURE.md`'s
`RunReceipt.signature`, `algorithm: "ed25519"`) is present and verified
against a public key obtained outside the receipt itself. This repository
does not ship a signing key or a trusted root; every current receipt is
tamper-evident only, and every doc/README claim says so explicitly.

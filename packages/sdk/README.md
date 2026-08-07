# @null-city/sdk

A runtime-validated TypeScript client implementing NullCity's public
`PlayerSession` interface — the same interface the Command Center browser
app, the benchmark runner, and the MCP adapter are all built on. No method
on `PlayerSession` ever returns truth: every value flows from
`PlayerSessionState` / player events, exactly as exposed by
`@null-city/server`'s REST/WS surface (`packages/server/src/rpc.ts`).

## What this package is (and is not)

- It **is** a thin, validated wrapper over `POST/GET /sessions/...`.
- It **is not** an in-process shortcut: even when the target server runs
  in the same Node process (as it does in the benchmark runner and in this
  package's own tests), the SDK always talks over real HTTP.
- It has **no** admin/internal methods (no snapshot access, no truth
  events, no bypass of the player transport).

## Install / build

This is a private workspace package. From the repo root:

```bash
pnpm install
pnpm --filter @null-city/sdk build
```

## Quickstart

```ts
import { createPlayerSession } from "@null-city/sdk";

const session = await createPlayerSession({
  baseUrl: "http://127.0.0.1:8787",
  scenarioId: "black-river",
  seed: 49314,
});

const state = await session.getState();
console.log(state.tick, state.claims.length, state.score.total);

const outcome = await session.submitCommand({
  commandName: "DISPATCH_TEAM",
  params: { teamId: "power-1", target: "industrial", task: "power_repair" },
  // idempotencyKey is optional — the SDK generates one and reuses it on retry.
});

await session.advance(30);

const summary = await session.getCompletedRun(); // null until phase === "completed"
```

A full runnable version of this against a real in-process server is at
[`examples/quickstart.mjs`](./examples/quickstart.mjs). After `pnpm build`
at the repo root, run it with:

```bash
node packages/sdk/examples/quickstart.mjs
```

## Retries and idempotency

- `getState()`, `getEvents()`, and `getCompletedRun()` are pure reads and
  are always retried on transient network failures.
- `submitCommand()` is retried using its `idempotencyKey` (generated with
  `crypto.randomUUID()` if you don't supply one). The engine
  (`packages/simulation/src/engine.ts`) rejects a re-submitted key with
  `duplicate_command` rather than executing it twice, so a lost response
  followed by a retry can never cause a command to run twice. The SDK
  surfaces this as `outcome.deduplicated === true` rather than as an error.
- `advance()` and `submitAssessment()` have **no** server-side dedup key
  (a duplicate `advance` would double-count ticks; a duplicate `assess`
  would record a belief twice), so the SDK never auto-retries them. A
  network failure surfaces as a `NetworkError` immediately.

## Runtime validation

Every response is parsed through a zod schema (`src/schemas.ts`) before
any field reaches caller code. A response that is valid JSON but the
wrong shape — or larger than the 16MB defensive bound — raises a
`ValidationError` instead of silently producing `undefined`s. A
`{ ok: false, error }` envelope raises an `ApiError` carrying the server's
real `code`.

## What's covered by tests

- `test/session.test.ts` — a full golden-script run over the real REST
  surface reproduces the same score/tick as a direct in-process engine
  run, plus `getEvents`/`getCompletedRun` edge cases.
- `test/retry.test.ts` — a transient failure on `submitCommand` is
  retried and the command still executes exactly once; a deliberate or
  retried duplicate `idempotencyKey` is reported as `deduplicated` rather
  than re-executed; `advance()` is never auto-retried.
- `test/validation.test.ts` — malformed/oversized/error responses all
  raise the right typed error.
- `test/forbidden-imports.test.ts` — `src/` never imports
  `@null-city/simulation`, `@null-city/epistemics`, or
  `@null-city/server`, and never references an internal/admin method name.
- `test/leak.test.ts` — every payload the SDK returns across a full run is
  scanned with `@null-city/epistemics`'s `detectPublicLeak` (a **dev**-only
  dependency, never imported from `src/`) and found clean.

## WebSocket events (optional)

`subscribeEvents()` is a push-based alternative to polling `getEvents()`,
over the same `/ws/:sessionId` surface the browser uses:

```ts
import { subscribeEvents } from "@null-city/sdk";

const sub = subscribeEvents({
  wsBaseUrl: "ws://127.0.0.1:8787",
  sessionId: session.sessionId,
  onEvents: (events) => console.log(events),
});
// later: sub.close();
```

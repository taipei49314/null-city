# @null-city/mcp-server

An MCP (Model Context Protocol) adapter that lets an MCP-speaking agent
(Claude Desktop, an SDK client, an LLM tool-caller, etc.) play NullCity
through **exactly** the same public interface the Command Center browser
app and the benchmark runner use — `@null-city/sdk`'s `PlayerSession`. No
tool here, and no code path anywhere in this package, ever reaches truth.

## What this package is (and is not)

- It **is** a thin MCP wrapper around one `PlayerSession`, bound at
  startup to a `(baseUrl, scenarioId, seed, sessionId)` — the same four
  things a human typing into the Command Center or a benchmark policy
  needs.
- It **is not** a second implementation: every tool call ends in a real
  call to `@null-city/sdk`, which talks to a real, already-running
  `@null-city/server` over HTTP. There is no in-process shortcut.
- It has **no** truth resource or tool, at any point, active run or
  completed. `test/forbidden-imports.test.ts` enforces that `src/` never
  imports `@null-city/simulation`, `@null-city/epistemics`, or even
  `@null-city/server` (unlike the benchmark runner, this adapter never
  owns a server process — it always connects to one that's already
  running).

## Install / build

This is a private workspace package. From the repo root:

```bash
pnpm install
pnpm --filter @null-city/mcp-server build
```

## Running the server

Start a `@null-city/server` first (any host, e.g. `pnpm server:start`),
then point the adapter at it via environment variables and run it as an
MCP stdio server:

```bash
NULLCITY_BASE_URL=http://127.0.0.1:8787 \
NULLCITY_SCENARIO_ID=black-river \
NULLCITY_SEED=49314 \
node packages/mcp-server/dist/cli.js
```

| Env var                  | Default                    | Meaning                                             |
| ------------------------ | --------------------------- | ---------------------------------------------------- |
| `NULLCITY_BASE_URL`      | `http://127.0.0.1:8787`     | Base URL of a running `@null-city/server`.           |
| `NULLCITY_SCENARIO_ID`   | `black-river`                | Scenario to create/resume a session for.             |
| `NULLCITY_SEED`          | `49314`                      | Deterministic seed.                                  |
| `NULLCITY_SESSION_ID`    | server-generated             | Resume a specific session instead of creating a new one. |
| `NULLCITY_TIMEOUT_MS`    | SDK default (`15000`)        | Per-request timeout before treating a call as a network error. |
| `NULLCITY_MAX_RETRIES`   | SDK default (`2`)            | Extra attempts for retryable failures.               |

To wire this into an MCP-capable client (e.g. Claude Desktop's
`mcpServers` config), point it at `node packages/mcp-server/dist/cli.js`
with the env vars above.

## Tools

All nine tools are read/write-annotated (`readOnlyHint` /
`destructiveHint` / `idempotentHint`) and bounded (list/event responses
are capped — see `src/limits.ts` — with `total`/`truncated` fields so a
client always knows if it's seeing a partial view):

| Tool                    | Kind      | Purpose                                                                  |
| ------------------------ | --------- | ------------------------------------------------------------------------- |
| `get_state`              | read-only | Full player-visible session snapshot (tick, phase, score, resources, bounded claims/evidence/assessments). |
| `get_events`             | read-only | Paginated player event log (`afterSequence`/`limit`), same hash-chained stream the SDK/browser read. |
| `list_claims`            | read-only | Claims, filterable by `status`/`districtId`, paginated.                  |
| `list_teams`             | read-only | The player's own response teams.                                        |
| `list_routes`            | read-only | Routes the player currently knows about.                                |
| `submit_command`         | write     | Dispatch a team, reroute power, close/reopen a route, request verification, issue an advisory, etc. Safe to retry (`idempotencyKey`); a deduplicated retry is reported as such, never re-executed. |
| `submit_assessment`      | write     | Submit a probability/confidence belief about a claim. Never auto-retried. |
| `advance_time`           | write     | Move the deterministic clock forward by up to 540 ticks. Never auto-retried. |
| `get_completed_summary`  | read-only | Terminal run summary once `phase === "completed"`, else `{ completed: false }`. |

## Examples

A full, runnable, non-LLM walkthrough (spins up a real server, drives a
`black-river` run to completion using only MCP tool calls over a real
MCP `Client`/`McpServer` pair) is at
[`examples/quickstart.mjs`](./examples/quickstart.mjs):

```bash
pnpm --filter @null-city/mcp-server build
node packages/mcp-server/examples/quickstart.mjs
```

### Optional LLM provider example

[`examples/llm-openai-policy.mjs`](./examples/llm-openai-policy.mjs)
demonstrates wiring an OpenAI model up as the decision-maker over this
same tool surface. It is **not** part of `pnpm verify`, `pnpm test`, or
any CI gate — provider/LLM logic does not belong in the deterministic
core, and a default suite that requires a paid API key is not
reproducible. It requires `OPENAI_API_KEY` and the (non-workspace)
`openai` package, and fails immediately with an actionable message if
either is missing:

```bash
npm install openai   # inside packages/mcp-server; not a workspace dependency
OPENAI_API_KEY=sk-... node packages/mcp-server/examples/llm-openai-policy.mjs
```

## What's covered by tests

- `test/parity.test.ts` — drives one shared `PlayerSession` through both
  a direct SDK call and the equivalent MCP tool call (over a real MCP
  `Client`/`McpServer` pair connected via `InMemoryTransport`, exercising
  the actual JSON-RPC tool-call and zod input-validation machinery) and
  asserts they agree: `get_state`/`list_teams`/`list_routes` mirror
  `session.getState()`; `submit_command`/`submit_assessment`/
  `advance_time` mutate the one real session such that a subsequent
  direct SDK read observes exactly what the tool reported; out-of-range
  inputs are rejected before ever reaching the session; every list/event
  tool honors its documented bound. It also asserts the exact documented
  tool set and its read/write annotations.
- `test/leak.test.ts` — every MCP tool response across a full
  golden-script run is scanned with `@null-city/epistemics`'s
  `detectPublicLeak` (a **dev**-only dependency, never imported from
  `src/`) and found clean.
- `test/forbidden-imports.test.ts` — `src/` never imports
  `@null-city/simulation`, `@null-city/epistemics`, or
  `@null-city/server`, never references a truth-only contracts symbol,
  and never registers a tool whose name suggests truth/snapshot/admin
  access.

Run them with:

```bash
pnpm build   # from repo root; workspace packages resolve via dist
pnpm --filter @null-city/mcp-server test
```

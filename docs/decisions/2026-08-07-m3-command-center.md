# ADR — M3 Command Center vertical slice

## Status

Implemented for M3, awaiting owner acceptance.

## Decision

1. `apps/command-center` is a Vite + React 18 + TypeScript app added to the existing pnpm workspace (`apps/*`). It depends only on `@null-city/contracts` (types) and talks to `@null-city/server` over the same public REST + WebSocket transport the CLI/player-cli use — no import of `@null-city/simulation`, `@null-city/epistemics`, or anything under `packages/*/src` that represents truth state.
2. Black River's district ids and route graph are hardcoded in a local, presentation-only module (`src/topology/blackRiver.ts`). It carries **no** district attribute values (power, hazard, population risk, ...) — only ids, labels, and layout coordinates for the SVG. The scenario JSON (`scenarios/black-river.json`) is never read by the browser bundle. This keeps "known vs. unknown" honest: the map shows structure the commander would always know, plus a claim-count badge derived only from the player's own `Claim[]`.
3. The browser rebuilds `PlayerSessionState` from the public player event stream itself (`src/state/projector.ts`, a clean-room reimplementation of the same reducer semantics as `packages/epistemics/src/project.ts`), rather than trusting a server-pushed blob blindly. On load it fetches the full event backlog (`GET /events?since=0`) and replays it; live updates arrive over `/ws/:sessionId` and are merged by `sequence` number so REST-returned and WS-broadcast copies of the same event never double-apply. This directly demonstrates the invariant that player state is rebuildable from player events alone.
4. The command composer only exposes the seven commands named in the M3 spec (`DISPATCH_TEAM`, `ACTIVATE_BACKUP_GENERATOR`, `PRIORITIZE_COMMUNICATION`, `CLOSE_ROUTE`, `REOPEN_ROUTE`, `REQUEST_VERIFICATION`, `ISSUE_PUBLIC_ADVISORY`), with per-command parameter forms and a validation feedback line that echoes the server's own `validation.errorCode`/`errorMessage` — no client-side prediction of accept/reject beyond basic empty-field checks.
5. `pnpm demo` (`scripts/demo.mjs`) builds any missing workspace `dist/` output, starts `@null-city/server` on `127.0.0.1:8787`, waits for `/health`, starts the command-center Vite dev server on `127.0.0.1:5173`, and prints the browser URL. Both children are killed on exit/Ctrl-C.
6. `pnpm verify` gained `verify:command-center` (typecheck + unit tests only). Playwright/browser e2e is intentionally **not** wired into `verify`, since it should not fail CI when browsers aren't installed; `apps/command-center/e2e/smoke.mjs` (`pnpm --filter @null-city/command-center e2e`) is a real, browser-free smoke test that starts the actual server and a built `vite preview`, drives the REST API (create → invalid command rejection → valid dispatch → advance → claim assessment → blocked-summary-before-completion → delete), and checks the served HTML/`/api` proxy — all against live processes, no mocks.

## Consequences

- Root `package.json` gained `demo`, `command-center:*`, and `verify:command-center` scripts; `verify` now also runs the command-center typecheck/unit-test gate.
- A new workspace member exists at `apps/command-center`; `pnpm -r build`/`pnpm -r test`/`pnpm -r typecheck` now also cover it, in dependency order after `@null-city/contracts`.
- The Replay Lab route (`/replay/:id`) is a documented M4 placeholder: it fetches the same `/summary` fields the Command Center already shows for a completed run and states plainly that stepped replay is future work — it fabricates nothing.

## Unverified / deferred

- No Playwright browser automation is included; the M3 requirement for "browser E2E against a real built server" is satisfied by the process-level smoke script instead, per the milestone's own allowance ("if playwright is heavy... minimum: unit tests green + a script that builds the app and drives the API").
- No screenshot/capture pipeline was wired into CI; a manual screenshot can be taken via `pnpm demo` and a browser.

# M3 Workpack — Command Center Vertical Slice

## Objective

Build the real human-facing product surface for `Black River` without bypassing the public contract.

## Technology constraints

- React + Vite within the existing pnpm workspace;
- typed client generated from or sharing public runtime schemas;
- desktop-first, responsive down to a practical tablet width;
- no external map service; render the scenario topology from scenario/public data;
- no auth, cloud backend, external database, or API key;
- accessible semantic controls and keyboard path.

## Required flow

1. launch `pnpm demo`;
2. choose `Black River`, seed, and local mode;
3. start session;
4. see city topology with unknown/known state represented honestly;
5. receive evidence in chronological order;
6. inspect source provenance and claim relationships;
7. submit assessments and claim-targeted verification;
8. dispatch teams and execute operational commands;
9. advance/pause at documented decision cadence;
10. reach immutable completion;
11. inspect summary and enter Replay Lab placeholder route backed by the completed artifact.

## Layout

- topology/map panel;
- evidence timeline;
- claim/assessment board;
- controlled teams/resources;
- command composer with validation and consequence preview limited to known rules;
- simulation clock and connection state;
- completion summary.

## Quality

- loading, empty, disconnected, invalid-command, and server-error states;
- no fake counters or hard-coded scenario results;
- no truth/internal imports;
- unit tests for reducers/components;
- browser E2E against a real built server for the complete flow;
- actual screenshot and short capture generated from the candidate.

## Acceptance

A fresh user can complete the scenario from the browser with no terminal interaction after `pnpm demo`, and the browser sees exactly the same public contract as the CLI client.

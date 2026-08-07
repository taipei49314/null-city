# M8 Workpack — Adversarial Release Candidate

## Objective

Attempt to falsify every public claim before tagging v0.1.

## Attack categories

- truth extraction through REST, WS, UI state, errors, logs, artifact timing, SDK, benchmark, and MCP;
- cross-session confused-deputy operations;
- snapshot omission, aliasing, version confusion, scenario/seed/session mismatch;
- event sequence gaps, tick rollback, stream swap, session swap, rehashing, forged anchors, terminal substitution;
- post-completion commands, assessments, reconnects, imports, and admin actions;
- malformed/oversized scenario, snapshot, event, WebSocket, artifact, and MCP payloads;
- weighted-route and scoring counterexamples;
- scenario reference/cycle/probability abuse;
- subscriber/handler failure isolation and resource exhaustion;
- package/install/start failures from clean machines;
- false README, screenshot, benchmark, or badge claims.

## Process

- use an independent review branch/worktree;
- reviewers do not trust existing tests as proof;
- build minimal counterexamples;
- retain reproduction scripts and logs;
- classify each result P0/P1/P2/P3;
- fix in separate logical changes and rerun the full release gate;
- do not tag while any P0/P1 against a release claim remains.

## Required deliverable

A completed `03_RELEASE_GATE.md` copy with evidence links, exact commands/exit codes, environment information, unresolved risks, and explicit release decision.

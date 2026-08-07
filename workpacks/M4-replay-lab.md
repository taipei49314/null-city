# M4 Workpack — Replay Lab and Run Artifacts

## Objective

Expose NullCity’s core value after completion: compare truth, evidence, belief, action, and outcome on one synchronized timeline.

## Run artifact

- canonical versioned format;
- scenario/engine/session identity;
- command and assessment traces;
- verified truth and player logs released only after completion;
- terminal digests and receipt hash;
- optional detached signature metadata;
- strict runtime parser with bounded input size;
- CLI `run verify`, `run inspect`, and `run compare`.

## Replay Lab

- timeline scrubber by tick/event;
- player-visible city state at tick;
- truth state at tick, clearly marked as post-run reveal;
- claims and assessment probabilities over time;
- evidence provenance and contradiction graph;
- action and team movement timeline;
- score deltas linked to causal events;
- compare two artifacts with the same scenario digest;
- export a concise Markdown report.

## Verification

- tamper any receipt/log field and verify rejection;
- rebuild player projection from player log;
- rebuild truth projection from truth log or deterministic re-simulation;
- verify command-trace re-simulation terminal equality;
- ensure active sessions cannot request the completed truth bundle early;
- browser opens only validated artifacts and handles invalid/oversized files safely.

## Acceptance

A user can finish a run, open Replay Lab, identify at least one false or late report that influenced a decision, compare against a second run, and verify both artifacts independently.

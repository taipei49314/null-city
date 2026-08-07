# M1 Workpack — Epistemic Boundary and Evidence Model

## Objective

Replace “truth with nulls” masking with a public model of claims, evidence, assessments, and owned operational state.

## Required design

- separate `TruthEvent` and `PlayerEvent` runtime schemas and stores;
- player projection reducer that consumes only `PlayerEvent[]`;
- observation-to-claim normalization with source, observed tick, delivered tick, content, category, reliability metadata, and corruption-hidden truth;
- claim statuses: reported, corroborated, contested, verified, refuted, stale;
- assessment submissions with probability/confidence history;
- verification commands target a claim/question and resolve only what the verification establishes;
- own-team state and known-route state are explicit public concepts;
- no district becomes omniscient because one report arrived or a team was dispatched.

## Public API

Implement runtime-validated endpoints/events for:

- session public state;
- player events after sequence;
- command submission;
- assessment submission;
- claim-targeted verification;
- completed summary.

Admin/audit truth access remains a separate internal interface and is not wired into browser/SDK/MCP paths.

## Verification

- projection rebuild equals live public state;
- deletion of truth store after player events are produced does not prevent public replay;
- compile-time forbidden-import tests or lint rules;
- property/black-box leak tests over random scenarios and observations;
- REST and WS parity;
- claim lifecycle fixtures for corroboration, contradiction, staleness, verification, and refutation;
- no exact truth value appears unless a public event explicitly establishes it.

## Acceptance

A minimal CLI player can finish `Black River` using only the public contract. Independent tests cannot obtain hidden incidents, current truth attributes, future schedules, or corruption flags during the active run.

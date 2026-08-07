# M5 Workpack — SDK, Benchmark, and MCP

## Objective

Allow external policies and LLM agents to play NullCity through the exact same public interface as a human.

## TypeScript SDK

- runtime-validated client;
- `PlayerSession` interface;
- REST/WS support as required by the server contract;
- retries/idempotency without duplicating commands;
- no internal/admin methods;
- examples using built packages.

## Benchmark runner

- local scenario/seed matrix;
- deterministic non-LLM policies: no-op, reactive-greedy, verification-first;
- policy timeouts and bounded outputs;
- record commands, assessments, errors, metadata, and run artifacts;
- JSON and Markdown reports;
- compare policies across scenarios/seeds;
- no API key required for default suite.

## Metrics

- final operational outcome;
- population risk and infrastructure availability;
- response stage latencies;
- invalid command rate;
- resource efficiency and wasted dispatch;
- false advisory cost;
- cascade count/penalty;
- assessment Brier score and calibration bins;
- verification information gain.

All metrics must be documented and recomputable from verified artifacts.

## MCP adapter

- built on the SDK/public API only;
- tools for observe state/events, inspect claims/teams/routes, submit assessment, submit command, and inspect completed summary;
- clear read/write annotations and bounded payloads;
- no truth resource/tool during active runs;
- parity tests against direct SDK calls.

## Optional provider example

One documented adapter may demonstrate an LLM policy, but it stays outside default CI and must fail clearly without credentials. Do not add provider logic to the kernel.

## Acceptance

The same scenario/seed can be played by browser, baseline policy, and MCP client, with contract-level evidence that none receives privileged truth.

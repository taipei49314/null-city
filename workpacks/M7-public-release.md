# M7 Workpack — Public Repository and Release Engineering

## Objective

Make the repository understandable, runnable, testable, and credible to an outside developer.

## README

The first screen must contain:

- project name and tagline;
- actual product GIF/screenshot;
- concise explanation of truth/evidence/belief/action/replay;
- three-command quick start;
- features and non-goals;
- architecture diagram;
- human and agent examples;
- benchmark example generated from the candidate;
- integrity terminology and limitations;
- links to docs and contributing.

## Repository files

- LICENSE matching package metadata;
- CONTRIBUTING.md;
- CODE_OF_CONDUCT.md;
- SECURITY.md;
- CHANGELOG.md;
- CITATION.cff;
- architecture, protocol, scenario authoring, benchmark, and threat-model docs;
- issue/PR templates and sensible labels where applicable.

## CI/release

- install with frozen lockfile;
- lint;
- typecheck;
- unit/integration tests;
- browser E2E;
- build;
- determinism/invariant suite;
- package tarball smoke;
- Docker smoke;
- fresh-clone demo smoke where practical;
- release archive and checksums;
- no silent `continue-on-error` for required jobs.

## Packaging

- built exports only;
- clean/package scripts;
- production start command;
- example imports from packed tarballs;
- no source-only export that requires unpublished loaders;
- Node/package-manager versions documented and enforced coherently.

## Acceptance

A reviewer unfamiliar with the repository can clone it, run the demo, complete or replay a scenario, run the baseline benchmark, and verify an artifact by following only the tagged README/docs.

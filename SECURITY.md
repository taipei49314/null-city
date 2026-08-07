# Security Policy

## Scope

NullCity is a local-first, deterministic crisis-decision benchmark. It has
no accounts, no hosted service, and no production deployment maintained by
this project — everything runs on a contributor's or player's own machine or
CI runner (see `00_NORTH_STAR.md`'s "not required for v0.1" list). The
security properties that matter here are:

- **Information-boundary integrity**: no player-facing surface (REST, WS,
  browser, SDK, benchmark, MCP) can be made to reveal truth-only state
  during an active run.
- **Session scoping**: a client cannot read or mutate another session's
  state.
- **Input handling**: the server does not crash, leak, or misbehave on
  malformed, oversized, or adversarial request bodies/scenario files.
- **Completed-run immutability**: no request can mutate a finalized run.
- **Dependency hygiene**: no committed secret, and dependency findings are
  reviewed rather than silently ignored.

It explicitly does **not** cover: production hardening for a
public-internet-facing deployment (none is shipped or recommended), or any
claim of cryptographic authenticity beyond the tamper-evident hash chains
described in `docs/protocol.md` and `01_TARGET_ARCHITECTURE.md`'s "Run
artifact" section.

## Reporting a vulnerability

If you find a way to:

- read or infer truth-only state (an unobserved incident's real value,
  hidden RNG draws, another player's session, an internal counter/queue) from
  any player-facing REST/WS/SDK/MCP/browser surface, or
- mutate a completed/finalized run, bypass session scoping, or crash the
  server with a malformed request,

please report it privately rather than opening a public issue: open a
[GitHub security advisory](../../security/advisories/new) on this
repository, or, if that is unavailable to you, open an issue titled
`[SECURITY] <one-line summary, no exploit details>` and a maintainer will
follow up for a private channel.

Please include:

- the exact request/command sequence that reproduces the issue;
- the scenario id, seed, and session id used (all runs are deterministic and
  reproducible from these three values, so this alone usually reproduces
  the issue);
- what you observed vs. what the truth/public boundary should have allowed.

## Response

This is a community-maintained open-source project without a dedicated
security team or SLA. We aim to acknowledge a report within 5 business days
and to publish a fix or mitigation, credited to the reporter unless they
prefer otherwise, once a regression test proving the fix exists.

## Supported versions

Only the latest tagged release and the `main` branch receive security fixes.
There is no long-term-support branch.

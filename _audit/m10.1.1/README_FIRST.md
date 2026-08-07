# NullCity M10.1.1 — Final Fresh-Clone and Fail-Closed Closure

This is the final pre-push patch for `null-city-m10.1-prepush-closure.zip`.

It is **not** a feature milestone. Do not add scenarios, redesign the UI, change scoring, refactor the simulation engine, or expand deployment scope.

Use Cursor Plan Mode and paste `01_CURSOR_M10_1_1_KICKOFF.md` in full.

The hard blockers are deterministic:

1. A tracked M10.1 test reads a fixture from excluded `_audit/`, so a fresh checkout cannot load the test module.
2. Replay Lab accepts some malformed, fully resealed event payloads as `PARTIAL / semanticBindingsOk=true`, then projection code can crash.
3. Several browser semantic checks remain one-way and the bundled verification transcript predates the delivered source tree.

After this patch, the only remaining release gate should be exact-commit GitHub Actions plus Docker smoke.

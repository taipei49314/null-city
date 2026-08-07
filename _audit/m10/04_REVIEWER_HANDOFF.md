# Independent Reviewer Handoff

The next reviewer should not begin by reading `STATUS.md`. Begin with the counterexamples.

1. Run every file under `repro/` against the candidate verifier.
2. Confirm the forgeries are fully resealed, not merely edited.
3. Confirm the rejection reason is semantic, not a stale outer hash.
4. Run a real verification-first benchmark session and inspect emitted player events.
5. Confirm at least one claim resolves and that assessments/metrics reflect it.
6. Delete or hide the compiled scenario and ensure default CLI verification does not print PASS.
7. Compare the exact Git SHA/tree in `EVIDENCE.md` to the checkout.
8. Verify no committed fixture violates terminal ordering.
9. Only after these checks, review aggregate test totals.

Aggregate green tests are supporting evidence, not the root of trust.

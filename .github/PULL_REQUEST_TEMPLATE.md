## Summary

<!-- What does this change, and why? Link the issue/milestone workpack it addresses. -->

## Type of change

- [ ] Bug fix (with a regression test that fails on the inherited behavior)
- [ ] New scenario content (`scenarios/*.json` only, no source-code change)
- [ ] Feature (implements a specific milestone/workpack acceptance criterion)
- [ ] Docs
- [ ] Release engineering / CI

## Checklist

- [ ] `pnpm verify` passes locally (paste the final `PASS`/exit-code lines below).
- [ ] Added or extended a test that attacks the claim (black-box/reference-model
  preferred over an implementation-mirroring assertion).
- [ ] No new import crosses a forbidden boundary (`test/forbidden-imports.test.ts`
  in the affected package(s) still passes) — player-facing code never gains
  access to truth types/stores.
- [ ] No `test.only`, no skipped critical test, no `continue-on-error` added to
  a required CI job.
- [ ] Updated `STATUS.md`/`EVIDENCE.md` if this completes or partially
  completes a tracked milestone; otherwise the summary above states the
  exact commands run and their results.
- [ ] No unrelated formatting churn mixed into a functional-change diff.

## Verification

<!-- Exact commands + exit codes + result counts. "It works" without a
     command/output is not evidence. -->

```
$ pnpm verify
...
```

## Risks / follow-ups

<!-- Known limitations, deferred work, or anything a reviewer should double-check. -->

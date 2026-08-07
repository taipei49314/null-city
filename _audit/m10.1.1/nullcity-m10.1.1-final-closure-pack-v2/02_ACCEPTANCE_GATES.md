# M10.1.1 Acceptance Gates

| Gate | Required result |
|---|---|
| Test dependency closure | No source/test import or file read from `_audit/` |
| Fixture packaging | M10.1 test and all fixtures it reads are present in source + release archives |
| Fresh checkout | Test module loads and full suite runs with no workpack/audit directory |
| Strict event schema | Every supported truth/player kind has runtime payload validation |
| Structural bounds | Depth, event count, string/array/object sizes, sequence/tick/count ranges bounded |
| Fail-closed loader | `FAIL` artifact is never passed to Replay Lab projectors/exporters |
| Crash regression | Malformed evidence and excessive nesting render controlled rejection, no throw |
| Browser status | Honest artifact remains `PARTIAL`, never full PASS |
| Command cardinality | Truth issued ↔ truth outcome ↔ player result is exactly 1:1:1 |
| Session binding | Every truth/player envelope session ID equals artifact identity |
| Summary binding | Incident and terminal counts are derived or explicitly `NOT CHECKED` |
| Verification scopes | Replay, digest, ledger, authenticity, protocol claims each expose named status |
| Fully resealed attacks | All listed counterexamples rejected or explicitly downgraded with reasons |
| Local exact commit | `pnpm verify` and E2E exit 0 |
| Fresh clone | `pnpm verify` and E2E exit 0 from empty clone of same commit |
| Release archive | Self-contained and passes release canary/source-package checks |
| Remote gates | GitHub verify + required Docker smoke green |
| Evidence | Commit/tree/workflow/transcripts all refer to same final source |
| Worktree | Clean after evidence capture |

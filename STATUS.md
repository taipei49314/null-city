# STATUS — NullCity M10.1.2 Projection-Safe Parser Closure

## Overall

Status: **MERGED + TAGGED**  
Release decision: `v0.1.0-alpha.1` published from exact merged `main`  
Remote: https://github.com/taipei49314/null-city  
PR: https://github.com/taipei49314/null-city/pull/1  

Verified / tagged commit: `cb80e31575ff895a6f6f8ea780aa65495fa487d9`  
Tree: `c0f4e59972e020e95683752703dc57bdfe2b7627`

## M10.1.2 shipped

| Workstream | Status | Notes |
|---|---|---|
| Nested `SystemStateChanged` teams/routes validation | PASS | Rejected at parse before verify/projection |
| Adjacent nested schema parity | PASS | districts, evidenceIds, score raw/breakdown, enums, ticks, [0,1] |
| Visible projection fatal | PASS | No blank Replay Lab on projector throw |
| Fully resealed regressions | PASS | See `EVIDENCE.md` |
| Exact-tree + remote CI | PASS | Required `verify` + `docker-smoke` green on PR #1 |

## CI

- Required checks on `main`: verify job name + docker-smoke job name  
- Green run: https://github.com/taipei49314/null-city/actions/runs/31182426759  

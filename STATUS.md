# STATUS — NullCity M10.1.2 Projection-Safe Parser Closure

## Overall

Status: IMPLEMENTED (local + fresh-clone green)  
Release decision: **HOLD for public main/tags** until remote CI + Docker smoke are green  
Honesty: Remote CI / Docker / push remain **BLOCKED** (no git remote).

Verified source commit: `30a1aec04b0847c343bd79aacb9a5d7cca54611b`  
Tree: `88f73e13dc0f6d1d790017224649e6b280c53420`

Prior: M0–M10.1.1

## M10.1.2 shipped

| Workstream | Status | Notes |
|---|---|---|
| Nested `SystemStateChanged` teams/routes validation | PASS | Rejected at `parseReplayArtifact` before verify/projection |
| Adjacent nested schema parity | PASS | districts, evidenceIds, score raw/breakdown, enums, ticks, [0,1] |
| Visible projection fatal | PASS | No blank Replay Lab on projector throw |
| Fully resealed regressions | PASS | See `EVIDENCE.md` mapping |
| Exact-tree evidence | PASS (local/fresh-clone) | Remote still BLOCKED |

## Still blocked

1. Configure git remote and push  
2. GitHub Actions `verify` + required Docker smoke green  
3. Tag / public main promotion  

# STATUS — NullCity M10.1.2 Projection-Safe Parser Closure

## Overall

Status: IMPLEMENTED (local + fresh-clone pending fill)  
Release decision: **HOLD for public main/tags** until remote CI + Docker smoke are green  
Honesty: Remote CI / Docker / push remain **BLOCKED** while no git remote is configured.

Prior: M0–M10.1.1

## M10.1.2 shipped

| Workstream | Status | Notes |
|---|---|---|
| Nested `SystemStateChanged` teams/routes validation | PASS | Clean-room parity with contracts truth schemas; rejected at parse |
| Adjacent nested schema parity | PASS | districts, evidenceIds, score raw/breakdown, enums, nullable ticks, [0,1] assessments |
| Visible projection fatal | PASS | Projector exceptions route to “Artifact rejected during projection” + Load another run |
| Fully resealed regressions | PASS | `replay-verify-m10.1.1.test.ts` covers teams/routes/districts/breakdown/evidenceIds |
| Exact-tree evidence | IN PROGRESS | See `EVIDENCE.md` |

## Still blocked

1. Configure git remote and push  
2. GitHub Actions `verify` + required Docker smoke green  
3. Tag / public main promotion  

## How to demo

```bash
pnpm demo
# Hostile nested SystemStateChanged teams/routes must fail at load, never blank Replay Lab
```

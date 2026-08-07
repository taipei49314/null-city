# STATUS — NullCity M10.1.1 Final Pre-Push Closure

## Overall

Status: IMPLEMENTED (local + fresh-clone green)  
Release decision: **HOLD for public main/tags** until remote CI + Docker smoke are green  
Honesty: Remote CI / Docker / push remain **BLOCKED** (no git remote).

Verified source commit: `e22d31a87751404ccaa0b73347d94ea3761c31f2`  
Tree: `38de8f623e5035369e964a56f09d15491bbe9234`

Prior: M0–M10.1

## M10.1.1 shipped

| Workstream | Status | Notes |
|---|---|---|
| P0-A fixture self-containment | PASS | Tracked fixture; `verify:no-external-workpack`; archive packs test+fixture |
| P0-B fail-closed parsing | PASS | Per-kind validation; depth bounds; loader never projects FAIL |
| P1 semantic precision | PASS | 1:1:1 commands; session bind; derived summaries; named NOT_CHECKED scopes |
| P1 exact-tree evidence | PASS (local/fresh-clone) | See `EVIDENCE.md`; remote still BLOCKED |

## Still blocked

1. Configure git remote and push  
2. GitHub Actions `verify` + required Docker smoke green  
3. Tag / public main promotion  

## How to demo

```bash
pnpm demo
# Replay Lab: load data/m4-run-a.artifact.json → PARTIAL + named NOT_CHECKED scopes
node packages/simulation/dist/cli/run.js verify --artifact data/m4-run-a.artifact.json
```

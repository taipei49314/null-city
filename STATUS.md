# STATUS — NullCity M10.1.1 Final Pre-Push Closure

## Overall

Status: IMPLEMENTED (local + fresh-clone pending evidence fill)  
Release decision: **HOLD for public main/tags until remote CI + Docker smoke are green**  
Honesty: Remote CI / Docker / push remain **BLOCKED** while no git remote is configured.

Prior: M0–M10.1

## M10.1.1 shipped

| Workstream | Status | Notes |
|---|---|---|
| P0-A fixture self-containment | PASS | Tracked `test/fixtures/minimal-semantic-forgery.artifact.json`; `verify:no-external-workpack`; release archive requires test+fixture |
| P0-B fail-closed parsing | PASS | Per-kind payload validation; depth bounds; ArtifactLoader never `onLoaded` on FAIL; Replay Lab guards projections |
| P1 semantic precision | PASS | Exact 1:1:1 command binding; session binding; derived active/handled/terminal counts; named NOT_CHECKED scopes; removed deprecated `ok` |
| P1 exact-tree evidence | IN PROGRESS | Local verify/e2e/fresh-clone recorded in `EVIDENCE.md` |

## Still blocked

1. Git remote + push  
2. GitHub Actions `verify` + required Docker smoke  
3. Tag / public main promotion  

## How to demo

```bash
pnpm demo
# Replay Lab: load data/m4-run-a.artifact.json → PARTIAL with named NOT_CHECKED scopes
node packages/simulation/dist/cli/run.js verify --artifact data/m4-run-a.artifact.json
```

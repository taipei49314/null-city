# STATUS — NullCity M10.1 Pre-Push Closure

## Overall

Status: IMPLEMENTED (local gates)  
Release decision: **NOT READY TO TAG / NOT READY TO PUSH** until remote exists and CI/Docker are green  
Honesty: Remote CI / Docker daemon / fresh-clone-from-remote remain **BLOCKED** (no push). Exact-commit recorded in `EVIDENCE.md` (`ce9a013…` / tree `ce6c061…`).

Prior: M0–M10 Integrity Closure

## M10.1 shipped

| Workstream | Status | Notes |
|---|---|---|
| A browser verifier honesty | PASS | `status` FAIL\|PARTIAL; integrity + semantic bindings; resealed CommandResult forge → semantic FAIL; UI/report never unqualified full PASS |
| B public package completeness | PASS | release allowlist includes selected `data/**` + governance roots; `pnpm verify:markdown-links` in `pnpm verify` |
| C README truthfulness | PASS | five scenarios; active-run truth boundary; browser = partial / CLI = authoritative |
| D local exact-commit gates | PASS (local) | frozen install, `pnpm verify`, e2e, release-archive; see `EVIDENCE.md` for SHA/tree |

## Full verify

`pnpm install --frozen-lockfile` — exit 0  
`pnpm verify` — **exit 0** (includes markdown-links + release-archive + audit-repro + adversarial)  
`pnpm command-center:e2e` — **exit 0**

## Still blocked for public push / tag

1. Live Docker daemon smoke  
2. Remote CI on a real runner  
3. Fresh clone from a pushed remote commit  
4. Independent second reviewer re-run of M10.1 reproductions  

## How to demo

```bash
pnpm demo
# Browser Replay Lab: load data/m4-run-a.artifact.json → expect PARTIAL, not full PASS
node packages/simulation/dist/cli/run.js verify --artifact data/m4-run-a.artifact.json
```

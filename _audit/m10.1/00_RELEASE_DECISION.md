# NullCity M10 — Final Pre-Push Audit

**Audited archive:** `null-city-m10-integrity-closure.zip`  
**SHA-256:** `0168ec192c63ca6a42a42b9540e34b6b6d3679308dff1f9c7a51dc12f5d1b720`  
**Archive entries:** 356 files  
**Uncompressed size:** 16,962,149 bytes

## Release decision

| Action | Decision |
|---|---|
| Push this exact archive as a polished public GitHub repository | **HOLD** |
| Push to a private/dev branch for CI | **YES** |
| Public `main` after one small M10.1 closure pass | **YES** |
| Create `v0.1.0`, `v0.1.0-rc.1`, or claim full release verification now | **NO** |

The project is close. The kernel/server/CLI M10 repairs are substantive, but one public-facing P0 remains in Replay Lab and the uploaded source package has visible GitHub presentation breakage.

## P0 — Replay Lab still gives a false full PASS

The authoritative CLI now requires compiled-scenario truth replay and player-projection replay by default. However, the browser verifier in `apps/command-center/src/replay/verify.ts` only checks hashes, counts, score/trace self-consistency, and the artifact self-hash. It does not use `publicActionLedger`, does not rebuild the player projection, and does not cross-bind player `CommandResult` events to truth outcomes.

The UI then renders:

```text
independent verify: PASS
```

and exported reports say:

```text
Independent client-side verification: PASS
```

### Reproduction

Using the repository's own `sample-run.artifact.json`:

1. Truth remained `CommandAccepted`.
2. Player-side `CommandResult` was changed from `accepted` to `rejected`.
3. Every attacker-computable player hash, `playerLogHash`, and `artifactHash` was recomputed.
4. The archive's own `parseReplayArtifact()` accepted it.
5. The archive's own `verifyReplayArtifact()` returned:

```json
{
  "ok": true,
  "reasons": []
}
```

A second minimal artifact with no `ScenarioStarted`, no `RunCompleted`, contradictory identity, invalid digest strings, and invented incident summaries also received PASS after resealing.

### Required fix

For M10.1, choose one honest contract:

1. **Preferred pre-push fix:** Rename the browser result to `Integrity check: PASS (partial)`, return explicit scope fields (`integrityOk`, `semanticBindingsOk`, `truthReplayChecked: false`, `playerReplayChecked: false`, `authenticity: none`), use a non-green PARTIAL badge, and direct full verification to the CLI/server replay path.
2. Also add semantic browser checks for genesis/terminal events, identity cross-binding, event kind/payload validation, player `CommandResult` ↔ truth outcome binding, terminal count/score binding, and incident-summary derivation where possible.
3. Add a regression test that fully reseals the player-history forgery. A test that edits bytes without resealing is insufficient.

Do not call this browser path “full independent verification” unless it actually performs both truth and player replay.

## P1 — The GitHub front page is visibly broken in this exact package

The uploaded archive contains **no `data/` files**, while the README embeds two screenshots and links to generated benchmark/evidence outputs. The two hero images will be broken on GitHub.

Missing README targets include:

- `data/evidence/m3-command-center-launch.png`
- `data/evidence/m3-command-center-session.png`
- `02_MILESTONE_ROADMAP.md`
- `CODE_OF_CONDUCT.md`
- `CITATION.cff`
- `data/benchmark-smoke/report.md`
- `data/benchmark-smoke/report.json`
- `data/evidence/m8-adversarial/report.md`
- `data/evidence/m10/external-audit-repro.md`
- `data/m4-run-a.artifact.json`

The prior M9 package contained the screenshots and root governance files, so this appears to be source-package drift during M10 delivery rather than unfinished product work.

### Required fix

- Restore/regenerate the screenshots and root files.
- Commit current M10 benchmark and audit evidence, or remove claims/links to files that are intentionally generated-only.
- Run a Markdown local-link gate over every tracked `.md` file.
- Ensure the release allowlist includes the chosen public evidence assets.

## P1 — README claims are stale or absolute where the implementation is scoped

- “Three distinct scenarios” is stale; the repository contains five.
- A later verification paragraph still says “all three scenarios.”
- “No truth ever reaches the browser” is false after completion because Replay Lab deliberately loads the truth bundle. The correct boundary is: **no truth reaches any player surface during an active run; completed artifacts may reveal truth inside Replay Lab.**

## What passed in this audit

- ZIP path traversal: none.
- Symlinks: none.
- `.env`, private-key, `node_modules`, `dist`, and `.git` entries: none.
- TypeScript/TSX syntax parse: 201 files, 0 parse errors.
- Workspace manifests vs `pnpm-lock.yaml`: 11 importers, 0 detected dependency-spec drift.
- Release archive canary: PASS; 5 canaries planted, 356 source entries checked, 3 denied by policy.
- Public snapshot/resume removal is present on REST/WebSocket paths.
- Public verification now takes `{teamId, claimId}` and derives the district server-side.
- Default artifact CLI verification requires replay; `--integrity-only` is labeled PARTIAL and exits non-zero.
- Completion ordering repair and artifact v2/public action ledger are present.

## Independent-runtime limitation

The archive reports `pnpm verify` exit 0 in its own `EVIDENCE.md`, but this environment could not independently rerun the dependency-based suite because `pnpm` was not installed and Corepack could not resolve `registry.npmjs.org` (`EAI_AGAIN`). Therefore this audit does not claim an independent full test pass. It performed source inspection, syntax parsing, lockfile consistency checks, release-archive canary execution, link/package checks, and direct execution of the browser verifier reproduction.

## Exact go/no-go gate

Push publicly only after all of the following are true on one committed tree:

- Browser Replay Lab no longer emits a false full PASS for the resealed player-history forge.
- README local link check returns zero missing tracked targets.
- Five-scenario wording and live-vs-post-run truth boundary are corrected.
- `pnpm install --frozen-lockfile && pnpm verify && pnpm command-center:e2e` pass in GitHub Actions.
- Required Docker smoke passes.
- Evidence records the exact commit SHA/tree and is generated from that commit.

At that point, public `main` is justified. An RC tag should follow the first green remote CI/Docker run, not precede it.

# Cursor Task — NullCity M10.1 Pre-Push Closure

## Mission

Make the current M10 tree honest and complete enough to push as a public GitHub repository. This is a release-closure task only.

## Hard scope

Do exactly four things:

1. Close the browser Replay Lab false-PASS path.
2. Restore or regenerate every public README/evidence target.
3. Correct stale/absolute README claims.
4. Produce exact-commit CI evidence.

Do **not** add a sixth scenario, redesign the UI, add auth/database/cloud/multiplayer, rewrite the engine, or increase the project scope.

---

## P0 — Browser Replay Lab verification scope

### Existing counterexample

Using `apps/command-center/test/fixtures/sample-run.artifact.json`:

- truth keeps `CommandAccepted`;
- player `CommandResult.state` is rewritten from `accepted` to `rejected`;
- all player-event hashes, `playerLogHash`, and `artifactHash` are recomputed;
- `parseReplayArtifact()` accepts it;
- `verifyReplayArtifact()` currently returns `{ ok: true, reasons: [] }`;
- the UI displays `independent verify: PASS`.

The reproduction log is in `reproduction/browser-verifier-repro.log`.

### Required contract

The browser does not execute the compiled simulation, so it must not claim the same scope as the authoritative CLI verifier.

Refactor `ReplayVerifyResult` to expose scope explicitly, for example:

```ts
type ReplayVerificationStatus = "FAIL" | "PARTIAL";

interface ReplayVerifyResult {
  status: ReplayVerificationStatus;
  integrityOk: boolean;
  semanticBindingsOk: boolean;
  truthReplayChecked: false;
  playerReplayChecked: false;
  authenticity: "none";
  reasons: string[];
}
```

Equivalent naming is acceptable, but these semantics are mandatory:

- Browser hash/envelope checks may say `Integrity: PASS`.
- Browser semantic bindings may say `Semantic bindings: PASS`.
- Browser must always say `Truth replay: NOT RUN` and `Player replay: NOT RUN`.
- Browser must never show a green, unqualified `independent verify: PASS`.
- Exported Markdown must use the same honest wording.
- Full verification must point users to the CLI command that loads the compiled scenario and performs both replays.

### Add semantic browser checks

Without importing `@null-city/simulation` or any live truth runtime into the Command Center, add at least:

- truth genesis is exactly one `ScenarioStarted` at sequence 0;
- truth terminal is exactly one final `ScenarioCompleted`;
- player genesis is exactly one `SessionStarted` at sequence 0;
- player terminal is exactly one final `RunCompleted`;
- identity ↔ start events ↔ terminal fields are cross-bound;
- allowed event kinds and strict payload schemas are enforced;
- every player `CommandResult` is cross-bound to the matching truth `CommandAccepted`/`CommandRejected` outcome;
- command ids/idempotency keys are unique and matched;
- terminal score/final tick/counts are cross-bound;
- handled/active incident summaries are derived from truth where possible;
- `stateDigest` is explicitly marked `NOT CHECKED` in browser scope rather than silently trusted.

### Mandatory regression

Add a test that fully reseals the counterexample. It must recompute every attacker-controlled hash. An unresealed byte edit is not an acceptable adversarial test.

The test must prove both:

1. The contradiction is rejected by semantic browser checks; and
2. The UI/report never upgrades a browser-only check to full PASS.

Also add the minimal semantic forgery in `reproduction/minimal-semantic-forgery.artifact.json` as a negative fixture or reproduce it in test code.

---

## P1 — Restore the public source package

The uploaded M10 ZIP contains no `data/` entries. Restore/regenerate all intended tracked README targets.

Recovery candidates are provided under `recovery_candidates/` for:

- `02_MILESTONE_ROADMAP.md`
- `CODE_OF_CONDUCT.md`
- `CITATION.cff`
- the two Command Center screenshots

Treat them as candidates: verify content and recapture screenshots if the current UI differs.

Regenerate from the exact final tree rather than copying stale M9 output:

- `data/benchmark-smoke/report.md`
- `data/benchmark-smoke/report.json`
- `data/evidence/m10/external-audit-repro.md`
- required current adversarial evidence
- sample `.artifact.json` files referenced by README/STATUS

Add a deterministic Markdown local-link checker to `pnpm verify`. It must inspect all tracked Markdown files and fail on missing relative links/images, while allowing valid GitHub-relative security URLs and anchors.

---

## P1 — README truthfulness

Correct all stale wording:

- `Three distinct scenarios` → five scenarios, naming all five or linking the suite.
- `all three scenarios` → all five scenarios.
- Replace absolute claims such as `no truth ever reaches the browser` with the actual boundary:
  - no truth reaches player surfaces during an active run;
  - completed artifacts may reveal truth inside Replay Lab for post-run analysis.
- Explain that browser verification is partial integrity/semantic checking; authoritative full replay is the CLI path.
- Do not claim cryptographic authenticity.

---

## Exact release gates

Before declaring M10.1 complete, provide:

1. `git rev-parse HEAD`
2. `git rev-parse HEAD^{tree}`
3. clean `git status --short`
4. `pnpm install --frozen-lockfile`
5. `pnpm verify`
6. `pnpm command-center:e2e`
7. Markdown local-link gate with zero missing targets
8. browser resealed-forgery regression output
9. `pnpm verify:release-archive`
10. GitHub Actions verify job green
11. GitHub Actions required Docker smoke green
12. fresh-clone rerun from the same commit

Update `STATUS.md` and `EVIDENCE.md` only from that exact commit. Do not write PASS for a gate that was not executed.

## Release wording

After all gates pass:

- public `main`: allowed;
- `v0.1.0-alpha.1`: allowed;
- `v0.1.0-rc.1`: only after remote CI + Docker + fresh-clone are green;
- stable `v0.1.0`: not part of this task unless an independent reviewer reruns the adversarial evidence.

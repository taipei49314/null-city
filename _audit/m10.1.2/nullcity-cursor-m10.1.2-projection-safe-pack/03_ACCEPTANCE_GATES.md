# M10.1.2 Acceptance Gates

## Gate A — parser/projector contract

- [ ] Fully resealed malformed truth team is rejected by `parseReplayArtifact`.
- [ ] Fully resealed malformed route is rejected by `parseReplayArtifact`.
- [ ] No malformed artifact accepted by the parser can make the current truth/player projectors throw in the covered event shapes.
- [ ] Projection exceptions render a visible fatal rejection with a recovery action.

## Gate B — nested schema parity

- [ ] `ScenarioStarted.districts[]` validates strings.
- [ ] `SystemStateChanged.teams[]` validates every required field.
- [ ] `SystemStateChanged.routes[id]` validates `{closed:boolean}`.
- [ ] `ScenarioCompleted.finalScore.raw` and `.breakdown[]` validate nested content.
- [ ] `ClaimUpdated.claim.evidenceIds[]` validates strings.
- [ ] nullable tick/range checks match authoritative schemas.

## Gate C — existing security semantics

- [ ] All M10.1/M10.1.1 fully resealed forgery tests remain green.
- [ ] Honest browser verification remains `PARTIAL`, never full PASS.
- [ ] Unsupported scopes remain explicitly `NOT_CHECKED`.
- [ ] Source/tests have no dependency on `_audit/`.

## Gate D — exact tree

- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `pnpm verify` passes.
- [ ] Command Center E2E passes.
- [ ] Release archive canary passes.
- [ ] Fresh clone of exact commit repeats all required gates.
- [ ] Final worktree is clean.
- [ ] GitHub Actions verify and Docker smoke are green.

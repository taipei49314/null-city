# Cursor Task — NullCity M10.1.2 Projection-Safe Parser Closure

You are working on the existing **NullCity M10.1.1 Final Closure** repository.

## Mission

Close the final reproduced browser artifact-boundary defect without expanding scope:

> A fully resealed artifact can place malformed nested values in `SystemStateChanged.teams` or `.routes`. The clean-room parser accepts it and browser verification returns `PARTIAL` with integrity/semantics green, but `projectTruthAtTick()` throws. Replay Lab can then display no content instead of a visible fatal rejection.

This task is complete only when hostile nested payloads are rejected **before projection**, projection errors are visible and recoverable, and the exact final commit passes local, fresh-clone, and remote release gates.

## Hard scope boundary

Allowed files are primarily:

- `apps/command-center/src/replay/event-payloads.ts`
- `apps/command-center/src/routes/ReplayLabPage.tsx`
- `apps/command-center/test/replay-verify-m10.1.1.test.ts`
- evidence/status files required to record exact results

Do **not**:

- add a sixth scenario
- change simulation mechanics or scoring
- redesign Command Center or Replay Lab
- add packages, databases, authentication, cloud, multiplayer, or MCP features
- rename M10.1.1 concepts
- weaken any existing verifier or acceptance test
- make `PARTIAL` look like full PASS
- claim remote CI/Docker passed before it actually passes

## Reproduced blocker

The current clean-room validator only checks that:

```ts
SystemStateChanged.teams  // is an array
SystemStateChanged.routes // is an object
```

It does not validate nested entries.

Attack A, fully resealed:

```ts
for (const event of artifact.truth.events) {
  if (event.kind === "SystemStateChanged") event.payload.teams = [{}, {}];
}
```

Current result:

```text
parse=PASS
verify=PARTIAL
reasons=[]
projectTruthAtTick=THROW Cannot read properties of undefined (reading 'localeCompare')
```

Attack B, fully resealed:

```ts
for (const event of artifact.truth.events) {
  if (event.kind === "SystemStateChanged") event.payload.routes = { forged: null };
}
```

Current result:

```text
parse=PASS
verify=PARTIAL
reasons=[]
projectTruthAtTick=THROW Cannot read properties of null (reading 'closed')
```

The authoritative runtime shapes already exist in `packages/contracts/src/truth-payloads.ts`:

```ts
teams: z.array(z.object({
  teamId: nonEmptyString,
  status: nonEmptyString,
  location: nonEmptyString,
  etaTick: nullableTickSchema,
  order: plainObject.nullable(),
})),

routes: z.record(z.object({ closed: z.boolean() })),
```

The browser must keep its clean-room implementation and must not introduce a forbidden runtime truth import.

## Required implementation

### 1. Nested truth state validation

In `event-payloads.ts`, add clean-room validators for:

- every `SystemStateChanged.teams[index]`
- every `SystemStateChanged.routes[id]`

Mirror the authoritative required fields and ranges. Reject malformed values during `parseReplayArtifact()`.

### 2. Close adjacent outer-container-only gaps

During the same narrow edit, bring these clean-room fields into parity with their authoritative schemas:

- `ScenarioStarted.districts[]`: non-empty bounded strings, at least one item
- `ClaimUpdated.claim.evidenceIds[]`: non-empty bounded strings
- `ScenarioCompleted.finalScore.raw`: validate all required numeric counters
- `ScenarioCompleted.finalScore.breakdown[]`: validate every required item field
- nullable ticks: integer >= 0 or null
- assessment probability/confidence: finite and within `[0,1]`
- truth corruption/loss enums: use the authoritative enum values

Do not add new protocol fields or make additive unknown fields strict unless an existing contract requires it.

### 3. Fail visibly on any projector exception

`ReplayLabPage.tsx` currently turns player/truth projection exceptions into `null`, which can leave the loaded Replay Lab blank.

Unify the two projections into a guarded result or otherwise route any exception into the existing visible fatal branch:

```text
Artifact rejected during projection: <controlled reason>
[Load another run]
```

A projector exception must never become an unexplained empty page.

### 4. Fully resealed regression tests

Add tests that assume the attacker recomputes:

- every truth event hash
- every player event hash
- stream tips and counts
- outer artifact hash

At minimum prove parser rejection for:

1. `SystemStateChanged.teams = [{}, {}]`
2. `SystemStateChanged.routes = { forged: null }`
3. `ScenarioStarted.districts = [{}]`
4. `ScenarioCompleted.finalScore.breakdown = [{}]`
5. `ClaimUpdated.claim.evidenceIds = [{}]`

The tests must use tracked fixtures under `apps/command-center/test/fixtures/`, never `_audit/`.

### 5. Preserve verification honesty

The honest sample must remain:

```text
status=PARTIAL
integrity=PASS
semanticBindings=PASS
truthReplay=NOT_CHECKED
playerReplay=NOT_CHECKED
stateDigest=NOT_CHECKED
scenarioDigest=NOT_CHECKED
protocol=NOT_CHECKED
publicActionLedger=NOT_CHECKED
authenticity=NOT_CHECKED
```

Do not relabel browser scope as full verification.

## Candidate patch

A candidate implementation is available in:

```text
patches/nullcity-m10.1.2-projection-safe.patch
```

Review it against the current tree. You may adapt it, but preserve the scope and acceptance behavior. Do not blindly claim it is correct without running all gates.

## Required evidence

Freeze one exact commit after implementation and record:

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --short
```

Then run on that exact tree:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
pnpm verify:markdown-links
pnpm verify:no-external-workpack
pnpm verify:release-archive
```

Create an empty-directory fresh clone of the exact commit and rerun:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm command-center:e2e
pnpm verify:release-archive
```

After push, require GitHub Actions:

- `verify`
- Docker smoke

Do not mark either remote gate PASS from local evidence.

## Deliverables

Return:

1. exact commit SHA and tree hash
2. clean `git status --short`
3. concise diff summary
4. one-to-one finding → test mapping
5. complete local verify transcript with commands and exit codes
6. fresh-clone transcript
7. release archive SHA-256 and entry count
8. GitHub Actions URLs/results once available
9. final `STATUS.md` and `EVIDENCE.md`

## Stop condition

Stop after this closure. Do not begin M11 or any new feature work.

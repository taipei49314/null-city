# Finding — Parser/Projector Nested Shape Mismatch

## Affected flow

```text
user-controlled .artifact.json
  -> parseReplayArtifact
  -> verifyReplayArtifact = PARTIAL
  -> projectTruthAtTick
  -> Replay Lab rendering
```

## Parser gap

`SystemStateChanged` validates `districts` entries and resource counters, but only validates the outer types of `teams` and `routes`.

## Projector assumptions

```ts
teams.sort((a, b) => a.teamId.localeCompare(b.teamId))
Object.entries(routes).map(([id, r]) => ({ id, closed: r.closed }))
```

## Before results

See `evidence/before-projection-repro.log`.

## Expected after results

See `evidence/after-candidate-patch-repro.log`.

The candidate patch rejects all tested malformed nested values at parse time, before verification or projection.

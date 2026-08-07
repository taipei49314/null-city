# NullCity Benchmark Report

Generated: 2026-08-07T10:24:30.116Z
Runs: 15

All metrics are computed from each run's hash-chain-verified public player event log only. No policy or metric in this report ever received truth.

## Summary

| Scenario | Seed | Policy | Verified | Final Tick | Score | Invalid Cmd Rate | Cascades | Wasted Dispatch | False Advisory | Brier | Info Gain |
|---|---|---|---|---|---|---|---|---|---|---|---|
| black-river | 49314 | noop | yes | 540 | -295.10 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| black-river | 49314 | reactive-greedy | yes | 540 | -143.61 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| black-river | 49314 | verification-first | yes | 540 | -144.76 | 0.000 | 2 | 0.00 | 0.00 | 0.423 | — |
| glass-harbor | 49314 | noop | yes | 480 | -218.23 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| glass-harbor | 49314 | reactive-greedy | yes | 480 | -40.66 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| glass-harbor | 49314 | verification-first | yes | 480 | -15.49 | 0.000 | 2 | 0.00 | 0.00 | 0.423 | — |
| signal-zero | 49314 | noop | yes | 450 | -209.42 | 0.000 | 1 | 0.00 | 0.00 | — | — |
| signal-zero | 49314 | reactive-greedy | yes | 450 | -69.43 | 0.000 | 1 | 0.00 | 0.00 | — | — |
| signal-zero | 49314 | verification-first | yes | 450 | -49.16 | 0.000 | 1 | 0.00 | 0.00 | 0.250 | — |
| mirror-district | 49314 | noop | yes | 420 | -309.55 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| mirror-district | 49314 | reactive-greedy | yes | 420 | -110.58 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| mirror-district | 49314 | verification-first | yes | 420 | -49.76 | 0.000 | 2 | 0.00 | 0.00 | 0.250 | — |
| red-ledger | 49314 | noop | yes | 450 | -302.90 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| red-ledger | 49314 | reactive-greedy | yes | 450 | -120.85 | 0.000 | 2 | 0.00 | 0.00 | — | — |
| red-ledger | 49314 | verification-first | yes | 450 | -73.55 | 0.000 | 2 | 0.00 | 0.00 | 0.250 | — |

## Best policy per scenario/seed (by final score)

| Scenario | Seed | Best Policy | Score |
|---|---|---|---|
| black-river | 49314 | reactive-greedy | -143.61 |
| glass-harbor | 49314 | verification-first | -15.49 |
| signal-zero | 49314 | verification-first | -49.16 |
| mirror-district | 49314 | verification-first | -49.76 |
| red-ledger | 49314 | verification-first | -73.55 |

## Per-run detail

### black-river / seed 49314 / noop

- Session: `bench-black-river-49314-noop`
- Player log: `f3125c75594aa90e1031741a010f8c5de4c35d997330caac66d05068e0520046` (350 events, chain valid: true)
- Phase: completed, final tick: 540
- Score total: -295.10
  - population risk contribution: -18.36, infrastructure contribution: 18.26
  - events handled: 0.00, events missed: -60.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -200.00, resource efficiency: 15.00
- Commands: 0 submitted, invalid rate 0.000 (none)
- Response latency: mean — ticks over 0/6 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### black-river / seed 49314 / reactive-greedy

- Session: `bench-black-river-49314-reactive-greedy`
- Player log: `817f32873a5b6517eb868a79ea706f1f4a60e8dd1e60d2e08ec279d0bcb570bc` (428 events, chain valid: true)
- Phase: completed, final tick: 540
- Score total: -143.61
  - population risk contribution: -15.00, infrastructure contribution: 22.39
  - events handled: 20.00, events missed: -30.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -106.00, resource efficiency: 15.00
- Commands: 7 submitted, invalid rate 0.000 (DISPATCH_TEAM: 7✓/0✗)
- Response latency: mean 11.5 ticks over 4/6 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### black-river / seed 49314 / verification-first

- Session: `bench-black-river-49314-verification-first`
- Player log: `b557a7161c79f1d33894e1f6315176d2da40363bbb30daddb43aa400df187348` (494 events, chain valid: true)
- Phase: completed, final tick: 540
- Score total: -144.76
  - population risk contribution: -15.00, infrastructure contribution: 21.24
  - events handled: 20.00, events missed: -30.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -106.00, resource efficiency: 15.00
- Commands: 8 submitted, invalid rate 0.000 (DISPATCH_TEAM: 7✓/0✗, REQUEST_VERIFICATION: 1✓/0✗)
- Response latency: mean 11.5 ticks over 4/6 claims
- Assessments: 6, resolved claims 1 (1 verified / 0 refuted), Brier score 0.423, verification info gain —

### glass-harbor / seed 49314 / noop

- Session: `bench-glass-harbor-49314-noop`
- Player log: `90a0b94e7741ec543391c11f4bd1003e8bf95b08d65ecb8395fbd43cd78b7b70` (205 events, chain valid: true)
- Phase: completed, final tick: 480
- Score total: -218.23
  - population risk contribution: -9.60, infrastructure contribution: 19.37
  - events handled: 0.00, events missed: -45.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -150.00, resource efficiency: 17.00
- Commands: 0 submitted, invalid rate 0.000 (none)
- Response latency: mean — ticks over 0/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### glass-harbor / seed 49314 / reactive-greedy

- Session: `bench-glass-harbor-49314-reactive-greedy`
- Player log: `24190fe2db04d37cd612496c836ab07f4afc71310be96f92e248309b9abbdcc9` (240 events, chain valid: true)
- Phase: completed, final tick: 480
- Score total: -40.66
  - population risk contribution: -4.80, infrastructure contribution: 22.14
  - events handled: 20.00, events missed: -15.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -30.00, resource efficiency: 17.00
- Commands: 6 submitted, invalid rate 0.000 (DISPATCH_TEAM: 6✓/0✗)
- Response latency: mean 14.0 ticks over 5/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### glass-harbor / seed 49314 / verification-first

- Session: `bench-glass-harbor-49314-verification-first`
- Player log: `22d5f62c5c612b4dbdfcfd6ec3c758c5ff7b29c46799787b43c1f90e2207c112` (257 events, chain valid: true)
- Phase: completed, final tick: 480
- Score total: -15.49
  - population risk contribution: -5.40, infrastructure contribution: 22.91
  - events handled: 30.00, events missed: 0.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -30.00, resource efficiency: 17.00
- Commands: 7 submitted, invalid rate 0.000 (DISPATCH_TEAM: 6✓/0✗, REQUEST_VERIFICATION: 1✓/0✗)
- Response latency: mean 14.0 ticks over 5/5 claims
- Assessments: 5, resolved claims 1 (1 verified / 0 refuted), Brier score 0.423, verification info gain —

### signal-zero / seed 49314 / noop

- Session: `bench-signal-zero-49314-noop`
- Player log: `ad98237cf7847bc11d0197ac366152d01e5e85c8b4b95199326730388a735870` (205 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -209.42
  - population risk contribution: -16.68, infrastructure contribution: 19.26
  - events handled: 0.00, events missed: -45.00
  - cascade count: 1 (penalty -25.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -150.00, resource efficiency: 8.00
- Commands: 0 submitted, invalid rate 0.000 (none)
- Response latency: mean — ticks over 0/7 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### signal-zero / seed 49314 / reactive-greedy

- Session: `bench-signal-zero-49314-reactive-greedy`
- Player log: `eb421a86576d8f99b0393c9c02f1a5e7c5e8db70ec163ca1070d11666345e814` (352 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -69.43
  - population risk contribution: -4.68, infrastructure contribution: 22.25
  - events handled: 10.00, events missed: -30.00
  - cascade count: 1 (penalty -25.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -50.00, resource efficiency: 8.00
- Commands: 5 submitted, invalid rate 0.000 (DISPATCH_TEAM: 5✓/0✗)
- Response latency: mean 18.1 ticks over 7/7 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### signal-zero / seed 49314 / verification-first

- Session: `bench-signal-zero-49314-verification-first`
- Player log: `94c7487d27c585f4ff1a44299a16018cc56aaac4db28a0e2b9bae3a49f657c83` (291 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -49.16
  - population risk contribution: -9.48, infrastructure contribution: 22.32
  - events handled: 20.00, events missed: -15.00
  - cascade count: 1 (penalty -25.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -50.00, resource efficiency: 8.00
- Commands: 7 submitted, invalid rate 0.000 (DISPATCH_TEAM: 5✓/0✗, REQUEST_VERIFICATION: 2✓/0✗)
- Response latency: mean 18.1 ticks over 7/7 claims
- Assessments: 7, resolved claims 2 (0 verified / 2 refuted), Brier score 0.250, verification info gain —

### mirror-district / seed 49314 / noop

- Session: `bench-mirror-district-49314-noop`
- Player log: `ee870903237f2eb72408d3cf2582a36d7cc3b394547a06994438689aa1033526` (297 events, chain valid: true)
- Phase: completed, final tick: 420
- Score total: -309.55
  - population risk contribution: -27.36, infrastructure contribution: 19.81
  - events handled: 0.00, events missed: -60.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -200.00, resource efficiency: 8.00
- Commands: 0 submitted, invalid rate 0.000 (none)
- Response latency: mean — ticks over 0/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### mirror-district / seed 49314 / reactive-greedy

- Session: `bench-mirror-district-49314-reactive-greedy`
- Player log: `dbea68fa7a16e6d596437e6557350a2a6d2ff15d78ef98a3d13eae29d1625dbd` (342 events, chain valid: true)
- Phase: completed, final tick: 420
- Score total: -110.58
  - population risk contribution: -13.92, infrastructure contribution: 21.34
  - events handled: 20.00, events missed: -30.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -66.00, resource efficiency: 8.00
- Commands: 5 submitted, invalid rate 0.000 (DISPATCH_TEAM: 5✓/0✗)
- Response latency: mean 14.8 ticks over 4/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### mirror-district / seed 49314 / verification-first

- Session: `bench-mirror-district-49314-verification-first`
- Player log: `761c5b7203a17f6baadff6e1dfb90fab3db95bce393c9f9be03fb05d8c0c6ba6` (353 events, chain valid: true)
- Phase: completed, final tick: 420
- Score total: -49.76
  - population risk contribution: -17.76, infrastructure contribution: 22.00
  - events handled: 40.00, events missed: 0.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -52.00, resource efficiency: 8.00
- Commands: 7 submitted, invalid rate 0.000 (DISPATCH_TEAM: 5✓/0✗, REQUEST_VERIFICATION: 2✓/0✗)
- Response latency: mean 18.0 ticks over 5/5 claims
- Assessments: 5, resolved claims 2 (2 verified / 0 refuted), Brier score 0.250, verification info gain —

### red-ledger / seed 49314 / noop

- Session: `bench-red-ledger-49314-noop`
- Player log: `ee9d08155e2872002768116ac291c2827b728fea4b8556f518c9275311258fdc` (240 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -302.90
  - population risk contribution: -28.08, infrastructure contribution: 19.18
  - events handled: 0.00, events missed: -60.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -200.00, resource efficiency: 16.00
- Commands: 0 submitted, invalid rate 0.000 (none)
- Response latency: mean — ticks over 0/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### red-ledger / seed 49314 / reactive-greedy

- Session: `bench-red-ledger-49314-reactive-greedy`
- Player log: `96f3a727ead8803a9a56a7acff1cb4bfecea2b5361b2ce69ccc2106400f8528b` (329 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -120.85
  - population risk contribution: -13.92, infrastructure contribution: 22.07
  - events handled: 10.00, events missed: -45.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -60.00, resource efficiency: 16.00
- Commands: 6 submitted, invalid rate 0.000 (DISPATCH_TEAM: 6✓/0✗)
- Response latency: mean 18.8 ticks over 5/5 claims
- Assessments: 0, resolved claims 0 (0 verified / 0 refuted), Brier score —, verification info gain —

### red-ledger / seed 49314 / verification-first

- Session: `bench-red-ledger-49314-verification-first`
- Player log: `ce0b8f3f62f1f80d9661739e0f397de019140535c81dba8155c4f5901e111815` (370 events, chain valid: true)
- Phase: completed, final tick: 450
- Score total: -73.55
  - population risk contribution: -17.28, infrastructure contribution: 22.73
  - events handled: 30.00, events missed: -15.00
  - cascade count: 2 (penalty -50.00), wasted dispatch: 0.00, false advisory cost: 0.00, decision delay: -60.00, resource efficiency: 16.00
- Commands: 8 submitted, invalid rate 0.000 (DISPATCH_TEAM: 6✓/0✗, REQUEST_VERIFICATION: 2✓/0✗)
- Response latency: mean 18.8 ticks over 5/5 claims
- Assessments: 5, resolved claims 2 (2 verified / 0 refuted), Brier score 0.250, verification info gain —

# M10 external audit reproduction

Generated: 2026-08-07T11:12:28.407Z

- P0-01 public resume: PASS (forbidden)
- artifact v2 export: PASS (actions=9)
- terminal RunCompleted: PASS
- A1 resealed weak digests rejected under full replay: PASS (scenarioDigest)
- A2 resealed player-history rewrite: PASS (player CommandResult state rejected contradicts truth outcome accepted for commandId cmd-1)
- A2b resealed terminal claimCount rejected: PASS (claimCount)
- D legacy receipt fixture absent (skipped; CLI wording still enforced in unit path)
- E policy claimId contract: PASS
- C default CLI verify rejects weak forge: PASS (exit=1)
- C --integrity-only reports limited scope: PASS (exit=2)
- release-archive canary: PASS

PASS m10-audit-repro

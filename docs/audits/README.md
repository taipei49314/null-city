# Initial audit artifacts

These files document the inherited alpha review. They are leads and historical evidence, not a substitute for reproducing defects under the real locked dependencies.

- `2026-08-07-initial-audit.md` — full review report.
- `2026-08-07-reproduction-evidence.json` — compact reproduction evidence.
- `2026-08-07-verify-audit.txt` — prior verify-entrypoint transcript and environment limitations. Renamed from `.log`: `.gitignore` excludes `*.log`, and so does the release archive's deny list, so evidence kept under that extension would not survive a clone. Contents are unchanged.
- `2026-08-07-integrity-repair.md` — closure matrix for the external v0.1.0 release audit (2 P0, 9 P1, 4 P2).

Cursor must preserve these artifacts, add new production-environment evidence separately, and never overwrite the historical record.

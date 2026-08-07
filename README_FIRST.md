# NullCity — Cursor Rebuild Pack

This pack turns the current NullCity alpha into a public-facing open-source project without discarding its useful core.

## North-star identity

> **NullCity is a deterministic crisis-response sandbox for evaluating human and AI decisions under uncertainty.**
>
> Humans and agents receive the same delayed, incomplete, and sometimes false information. Every completed run can be replayed, compared, and independently verified.

This is not a request to add a dashboard to the existing prototype. It is a staged rebuild around four non-negotiable properties:

1. **Truth is structurally inaccessible to players and agents during a run.**
2. **The deterministic kernel is reproducible across replay and snapshot/resume.**
3. **Completed results are immutable and produce a verifiable run receipt.**
4. **A human player and an AI policy use the same public contract.**

## How to use this pack

Copy the contents of this directory into the root of the existing `null-city` repository. Preserve paths such as `.cursor/rules/*` and `AGENTS.md`.

Then open the repository in Cursor and paste the contents of `04_CURSOR_KICKOFF_PROMPT.md` into **Plan Mode**.

Cursor must implement **M0 only** first. Do not authorize M1 until the M0 evidence report has been reviewed.

## File map

- `00_NORTH_STAR.md` — product identity, promises, users, anti-goals, showcase experience.
- `01_TARGET_ARCHITECTURE.md` — target module boundaries and public/private contracts.
- `02_MILESTONE_ROADMAP.md` — M0–M8 execution order and death gates.
- `03_RELEASE_GATE.md` — public-release verification matrix.
- `04_CURSOR_KICKOFF_PROMPT.md` — first prompt to paste into Cursor Plan Mode.
- `05_KNOWN_FINDINGS.md` — inherited audit findings that must not be lost.
- `AGENTS.md` — repository operating contract.
- `.cursor/rules/*` — persistent Cursor rules.
- `workpacks/*` — milestone-specific implementation contracts.
- `docs/audits/*` — inherited review report and reproduction evidence.
- `templates/*` — status, evidence, and decision-log templates.

## Authority model

Cursor is the primary implementation agent. It may plan, edit, run commands, debug, and prepare commits. It does not have release authority and may not self-certify a milestone. A milestone is accepted only after evidence is inspected by the project owner or an independent reviewer.

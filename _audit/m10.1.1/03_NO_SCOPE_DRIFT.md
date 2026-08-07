# No Scope Drift

Do not:

- add a sixth scenario;
- redesign Command Center or Replay Lab;
- change scoring, routes, incidents, or simulation mechanics;
- add auth, database, cloud, multiplayer, signing, hosting, or deployment features;
- rename packages or reorganize the monorepo;
- import privileged simulation/truth runtime code into the browser;
- loosen the truth boundary to reuse validators;
- inflate test totals without pinning the supplied counterexamples;
- label `PARTIAL` as PASS;
- claim fresh-clone, remote CI, Docker, or exact-tree PASS before those exact gates execute.

The intended diff is concentrated in:

- Replay artifact schema/validation;
- Replay verifier scope reporting;
- ArtifactLoader / ReplayLab fail-closed flow;
- Replay tests and tracked fixtures;
- release/self-containment gates;
- STATUS/EVIDENCE regeneration.

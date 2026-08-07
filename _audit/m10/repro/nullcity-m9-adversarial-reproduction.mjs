#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.argv[2] ?? '/mnt/data/null-city-m9-red-ledger-audit';
const out = [];
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const sortDeep = (v) => Array.isArray(v)
  ? v.map(sortDeep)
  : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
    : v;
const canonicalJson = (v) => JSON.stringify(sortDeep(v));
const clone = (v) => structuredClone(v);

function artifactBody(a) {
  const { artifactHash, ...body } = a;
  return body;
}
function receiptBody(r) {
  const { receiptHash, ...body } = r;
  return body;
}
function playerEventHash(e) {
  return sha256(canonicalJson({
    stream: 'player',
    sessionId: e.sessionId,
    sequence: e.sequence,
    tick: e.tick,
    kind: e.kind,
    payload: e.payload,
    previousHash: e.previousHash,
  }));
}
function rechainPlayer(events) {
  let previousHash = '';
  events.forEach((e, i) => {
    e.sequence = i;
    e.previousHash = previousHash;
    e.hash = playerEventHash(e);
    previousHash = e.hash;
  });
  return previousHash;
}

const artifactPath = join(root, 'data/m4-run-a.artifact.json');
const originalArtifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
const originalArtifactHash = sha256(canonicalJson(artifactBody(originalArtifact)));
out.push(`# NullCity M9 adversarial reproduction`);
out.push(`root=${root}`);
out.push(`artifact_original_hash_matches=${originalArtifactHash === originalArtifact.artifactHash}`);

// A1: official CLI calls verifyRunArtifact without a scenario and requireReplay=false.
// The verifier only validates digest syntax in this mode, so arbitrary 64-hex
// scenario/state digests remain self-consistent after resealing.
const weakCliForge = clone(originalArtifact);
weakCliForge.identity.scenarioDigest = sha256('attacker-selected-scenario-bytes');
weakCliForge.stateDigest = sha256('attacker-selected-terminal-state');
weakCliForge.artifactHash = sha256(canonicalJson(artifactBody(weakCliForge)));
writeFileSync('/mnt/data/nullcity-m9-forged-weak-cli.artifact.json', canonicalJson(weakCliForge));
out.push('');
out.push('[A1 weak CLI verification]');
out.push(`old_scenario_digest=${originalArtifact.identity.scenarioDigest}`);
out.push(`new_scenario_digest=${weakCliForge.identity.scenarioDigest}`);
out.push(`old_state_digest=${originalArtifact.stateDigest}`);
out.push(`new_state_digest=${weakCliForge.stateDigest}`);
out.push(`forged_artifact_hash_self_consistent=${sha256(canonicalJson(artifactBody(weakCliForge))) === weakCliForge.artifactHash}`);
out.push('source_path=packages/simulation/src/cli/run.ts calls verifyRunArtifact(artifact) without scenario/requireReplay');

// A2: rewrite what the player was told about a command while truth remains
// untouched. The player chain is rehashed, and deterministic replay only checks
// truth/state/score, never reconstructs the player projection.
const playerForge = clone(originalArtifact);
const playerCommand = playerForge.player.events.find((e) => e.kind === 'CommandResult');
if (!playerCommand) throw new Error('no CommandResult in fixture artifact');
const commandId = playerCommand.payload.commandId;
const truthOutcome = playerForge.truth.events.find((e) =>
  (e.kind === 'CommandAccepted' || e.kind === 'CommandRejected') && e.payload?.commandId === commandId
);
const beforePlayer = clone(playerCommand.payload);
playerCommand.payload.state = beforePlayer.state === 'accepted' ? 'rejected' : 'accepted';
playerCommand.payload.errorCode = 'forged_player_history';
playerCommand.payload.detail = 'FORGED: the player was told the opposite result';
playerCommand.payload.etaTick = null;
playerForge.playerLogHash = rechainPlayer(playerForge.player.events);
playerForge.artifactHash = sha256(canonicalJson(artifactBody(playerForge)));
writeFileSync('/mnt/data/nullcity-m9-forged-player-history.artifact.json', canonicalJson(playerForge));
out.push('');
out.push('[A2 player-history rewrite]');
out.push(`command_id=${commandId}`);
out.push(`truth_outcome_kind=${truthOutcome?.kind ?? 'missing'}`);
out.push(`original_player_state=${beforePlayer.state}`);
out.push(`forged_player_state=${playerCommand.payload.state}`);
out.push(`truth_log_hash_unchanged=${playerForge.truthLogHash === originalArtifact.truthLogHash}`);
out.push(`state_digest_unchanged=${playerForge.stateDigest === originalArtifact.stateDigest}`);
out.push(`forged_player_chain_tip=${playerForge.playerLogHash}`);
out.push(`forged_artifact_hash_self_consistent=${sha256(canonicalJson(artifactBody(playerForge))) === playerForge.artifactHash}`);
out.push('source_path=verifyByReplay compares truthLogHash/eventCount/stateDigest/score/finalTick only; no player projection replay');

// A3: legacy RunReceipt has no identity/terminal/state cross-binding. Change
// externally visible claims without touching the valid event stream, then reseal.
const golden = JSON.parse(readFileSync(join(root, 'scenarios/golden-receipts/red-ledger.receipt.json'), 'utf8'));
const originalReceipt = golden.receipt;
const originalReceiptHash = sha256(canonicalJson(receiptBody(originalReceipt)));
const receiptForge = clone(originalReceipt);
receiptForge.scenarioId = 'attacker-scenario';
receiptForge.seed = -777;
receiptForge.finalTick = 1;
receiptForge.stateDigest = sha256('forged-receipt-state');
receiptForge.handledIncidents = ['everything-was-handled'];
receiptForge.activeIncidents = [];
receiptForge.receiptHash = sha256(canonicalJson(receiptBody(receiptForge)));
writeFileSync('/mnt/data/nullcity-m9-forged-run.receipt.json', canonicalJson(receiptForge));
out.push('');
out.push('[A3 legacy RunReceipt rewrite]');
out.push(`receipt_original_hash_matches=${originalReceiptHash === originalReceipt.receiptHash}`);
out.push(`event_log_hash_unchanged=${receiptForge.eventLogHash === originalReceipt.eventLogHash}`);
out.push(`old_scenario_id=${originalReceipt.scenarioId}`);
out.push(`new_scenario_id=${receiptForge.scenarioId}`);
out.push(`old_seed=${originalReceipt.seed}`);
out.push(`new_seed=${receiptForge.seed}`);
out.push(`old_final_tick=${originalReceipt.finalTick}`);
out.push(`new_final_tick=${receiptForge.finalTick}`);
out.push(`forged_receipt_hash_self_consistent=${sha256(canonicalJson(receiptBody(receiptForge))) === receiptForge.receiptHash}`);
out.push('source_path=packages/simulation/src/receipt.ts verifyReceipt does not bind these fields to ScenarioStarted/ScenarioCompleted or replay');

// A4: official benchmark evidence: verification requests are submitted, but no
// claim is ever resolved because policy sends target, not claimId.
const report = JSON.parse(readFileSync(join(root, 'data/benchmark-smoke/report.json'), 'utf8'));
const runs = Array.isArray(report) ? report : report.runs ?? [];
const verificationRuns = runs.filter((r) => r.policyId === 'verification-first');
out.push('');
out.push('[A4 verification-first benchmark]');
out.push(`total_report_runs=${runs.length}`);
out.push(`verification_first_runs=${verificationRuns.length}`);
for (const r of verificationRuns) {
  const req = (r.commands ?? []).filter((c) => c.commandName === 'REQUEST_VERIFICATION');
  out.push(`${r.scenarioId}: requests=${req.length} resolved=${r.metrics?.resolvedClaimCount ?? 'n/a'} infoGain=${r.metrics?.verificationInfoGain ?? 'null'}`);
}
out.push('policy_path=packages/benchmark/src/policies/verificationFirst.ts emits {teamId,target}; rpc.ts only creates verificationRequest when claimId exists');

const output = `${out.join('\n')}\n`;
writeFileSync('/mnt/data/nullcity-m9-adversarial-reproduction.log', output, 'utf8');
process.stdout.write(output);

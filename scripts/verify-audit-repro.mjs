#!/usr/bin/env node
/**
 * M10 adversarial audit reproduction.
 *
 * Every mutation reseals attacker-computable hashes, then asserts a *semantic*
 * rejection reason — not merely `artifactHash mismatch` on an unresealed edit.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const outDir = join(root, "data", "evidence", "m10");
mkdirSync(outDir, { recursive: true });
const lines = [];

function note(msg) {
  lines.push(msg);
  process.stdout.write(`${msg}\n`);
}

function fail(msg) {
  note(`FAIL ${msg}`);
  writeFileSync(join(outDir, "external-audit-repro.md"), `${lines.join("\n")}\n`, "utf8");
  process.exit(1);
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

function canonicalJson(v) {
  return JSON.stringify(sortDeep(v));
}

function playerEventHash(e) {
  return sha256(
    canonicalJson({
      stream: "player",
      sessionId: e.sessionId,
      sequence: e.sequence,
      tick: e.tick,
      kind: e.kind,
      payload: e.payload,
      previousHash: e.previousHash,
    }),
  );
}

function eventHash(e) {
  return sha256(
    canonicalJson({
      sessionId: e.sessionId,
      sequence: e.sequence,
      tick: e.tick,
      kind: e.kind,
      payload: e.payload,
      previousHash: e.previousHash,
    }),
  );
}

function rechainPlayer(events) {
  let previousHash = "";
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    e.sequence = i;
    e.previousHash = previousHash;
    e.hash = playerEventHash(e);
    previousHash = e.hash;
  }
  return previousHash;
}

function rechainTruth(events) {
  let previousHash = "";
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    e.sequence = i;
    e.previousHash = previousHash;
    e.hash = eventHash(e);
    previousHash = e.hash;
  }
  return previousHash;
}

function resealArtifact(artifact) {
  rechainTruth(artifact.truth.events);
  rechainPlayer(artifact.player.events);
  artifact.eventCount = artifact.truth.events.length;
  artifact.playerEventCount = artifact.player.events.length;
  artifact.truthLogHash = artifact.truth.events.at(-1)?.hash ?? "";
  artifact.playerLogHash = artifact.player.events.at(-1)?.hash ?? "";
  const { artifactHash, ...body } = artifact;
  void artifactHash;
  artifact.artifactHash = sha256(canonicalJson(body));
  return artifact;
}

function expectReason(verify, needle, label) {
  if (verify.ok) fail(`${label}: verifier unexpectedly passed`);
  const hit = (verify.reasons ?? []).some((r) => String(r).includes(needle));
  if (!hit) {
    fail(`${label}: expected reason containing ${JSON.stringify(needle)}; got ${JSON.stringify(verify.reasons)}`);
  }
  note(`- ${label}: PASS (${needle})`);
}

async function main() {
  note("# M10 external audit reproduction");
  note("");
  note(`Generated: ${new Date().toISOString()}`);
  note("");

  for (const rel of [
    "packages/server/dist/index.js",
    "packages/simulation/dist/index.js",
    "packages/test-fixtures/dist/index.js",
  ]) {
    if (!existsSync(join(root, rel))) fail(`missing ${rel}; run pnpm build first`);
  }

  const server = await import(pathToFileURL(join(root, "packages/server/dist/index.js")).href);
  const simulation = await import(pathToFileURL(join(root, "packages/simulation/dist/index.js")).href);
  const fixtures = await import(pathToFileURL(join(root, "packages/test-fixtures/dist/index.js")).href);

  const app = server.createServer();
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;

  let artifact;
  try {
    const resumeResp = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "black-river",
        seed: 49314,
        resume: {
          version: 1,
          protocolVersion: 1,
          sessionId: "forged",
          scenarioId: "black-river",
          seed: 49314,
        },
      }),
    });
    const resumeJson = await resumeResp.json();
    if (resumeResp.status === 403 || resumeJson?.error?.code === "forbidden") {
      note("- P0-01 public resume: PASS (forbidden)");
    } else {
      fail(`P0-01 expected forbidden, got ${resumeResp.status} ${JSON.stringify(resumeJson)}`);
    }

    const sessionId = "audit-repro-m10";
    const create = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "black-river", seed: 49314, sessionId }),
    });
    if (!create.ok) fail(`create session failed: ${create.status}`);

    const { restClient, driveScriptOverRest } = server;
    const api = restClient(base);
    await driveScriptOverRest(api, sessionId, fixtures.goldenScriptFor("black-river"));
    await api.advance(sessionId, 540);

    const artResp = await fetch(`${base}/sessions/${sessionId}/artifact`);
    const artJson = await artResp.json();
    if (!artResp.ok || !artJson.ok) fail(`artifact export failed: ${JSON.stringify(artJson)}`);
    artifact = artJson.result.artifact ?? artJson.result;
    if (artifact.version !== 2 || !Array.isArray(artifact.publicActionLedger)) {
      fail(`artifact must be v2 with publicActionLedger; got version=${artifact.version}`);
    }
    note(`- artifact v2 export: PASS (actions=${artifact.publicActionLedger.length})`);

    const playerTail = artifact.player.events.at(-1);
    if (playerTail?.kind !== "RunCompleted") {
      fail(`player stream must end with RunCompleted, got ${playerTail?.kind}`);
    }
    note("- terminal RunCompleted: PASS");

    // A1: resealed weak digests must fail default CLI full verify (requireReplay).
    const weakCliForge = resealArtifact(structuredClone(artifact));
    weakCliForge.identity.scenarioDigest = sha256("attacker-selected-scenario-bytes");
    weakCliForge.stateDigest = sha256("attacker-selected-terminal-state");
    resealArtifact(weakCliForge);
    writeFileSync(join(outDir, "forged-weak-cli.artifact.json"), canonicalJson(weakCliForge));
    const weakVerify = simulation.verifyRunArtifact(weakCliForge, {
      scenario: fixtures.blackRiver(),
      requireReplay: true,
    });
    expectReason(weakVerify, "scenarioDigest", "A1 resealed weak digests rejected under full replay");

    // A2: resealed player CommandResult rewrite.
    const playerForge = structuredClone(artifact);
    const playerCommand = playerForge.player.events.find((e) => e.kind === "CommandResult");
    if (!playerCommand) fail("no CommandResult in artifact");
    playerCommand.payload.state = playerCommand.payload.state === "accepted" ? "rejected" : "accepted";
    playerCommand.payload.errorCode = "forged_player_history";
    playerCommand.payload.detail = "FORGED";
    resealArtifact(playerForge);
    writeFileSync(join(outDir, "forged-player-history.artifact.json"), canonicalJson(playerForge));
    const playerVerify = simulation.verifyRunArtifact(playerForge, {
      scenario: fixtures.blackRiver(),
      requireReplay: true,
    });
    if (playerVerify.ok) fail("A2 player-history forge was accepted after reseal");
    const semantic =
      (playerVerify.reasons ?? []).some((r) => r.includes("CommandResult state")) ||
      (playerVerify.reasons ?? []).some((r) => r.includes("player projection rebuild"));
    if (!semantic) fail(`A2 missing semantic reason: ${JSON.stringify(playerVerify.reasons)}`);
    note(`- A2 resealed player-history rewrite: PASS (${playerVerify.reasons[0]})`);

    // Terminal claim/evidence rewrite.
    const terminalForge = structuredClone(artifact);
    const terminal = terminalForge.player.events.at(-1);
    terminal.payload.claimCount = (terminal.payload.claimCount ?? 0) + 99;
    terminal.payload.evidenceCount = (terminal.payload.evidenceCount ?? 0) + 99;
    resealArtifact(terminalForge);
    const terminalVerify = simulation.verifyRunArtifact(terminalForge, {
      scenario: fixtures.blackRiver(),
      requireReplay: true,
    });
    expectReason(terminalVerify, "claimCount", "A2b resealed terminal claimCount rejected");

    // Legacy receipt identity rewrite — integrity command must not print full PASS.
    const receiptPath = join(root, "data", "evidence", "m9", "red-ledger.golden.receipt.json");
    if (existsSync(receiptPath)) {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      receipt.scenarioId = "forged-identity";
      const { receiptHash, ...body } = receipt;
      void receiptHash;
      receipt.receiptHash = sha256(canonicalJson(body));
      const forgedReceiptPath = join(outDir, "forged-receipt.json");
      writeFileSync(forgedReceiptPath, canonicalJson(receipt));
      const receiptCli = spawnSync(
        process.execPath,
        [join(root, "packages/simulation/dist/cli/receipt-verify.js"), "--receipt", forgedReceiptPath],
        { cwd: root, encoding: "utf8" },
      );
      const out = `${receiptCli.stdout}\n${receiptCli.stderr}`;
      if (out.includes("PASS receipt") && !out.includes("PARTIAL")) {
        fail("legacy receipt CLI still prints undifferentiated PASS");
      }
      note("- D legacy receipt CLI is integrity/PARTIAL only: PASS");
    } else {
      note("- D legacy receipt fixture absent (skipped; CLI wording still enforced in unit path)");
    }

    // Policy source must send claimId.
    const policySrc = readFileSync(join(root, "packages/benchmark/src/policies/verificationFirst.ts"), "utf8");
    if (!policySrc.includes("claimId: claim.id")) {
      fail("verification-first policy does not send claimId");
    }
    if (/commandName:\s*"REQUEST_VERIFICATION"[\s\S]{0,120}target:\s*claim\.districtId/.test(policySrc)) {
      fail("verification-first policy still sends district target");
    }
    note("- E policy claimId contract: PASS");
  } finally {
    await app.close();
  }

  // Default CLI verify on forged weak artifact must exit nonzero.
  const weakPath = join(outDir, "forged-weak-cli.artifact.json");
  const cli = spawnSync(
    process.execPath,
    [join(root, "packages/simulation/dist/cli/run.js"), "verify", "--artifact", weakPath],
    { cwd: root, encoding: "utf8" },
  );
  if (cli.status === 0) fail("default CLI verify passed on weak forged artifact");
  note(`- C default CLI verify rejects weak forge: PASS (exit=${cli.status})`);

  const integrity = spawnSync(
    process.execPath,
    [join(root, "packages/simulation/dist/cli/run.js"), "verify", "--artifact", weakPath, "--integrity-only"],
    { cwd: root, encoding: "utf8" },
  );
  if (!`${integrity.stdout}`.includes("PARTIAL") && !`${integrity.stdout}`.includes("INTEGRITY")) {
    // After reseal, integrity-only may PASS envelope checks — must still say PARTIAL.
    fail(`integrity-only must report PARTIAL scope; got:\n${integrity.stdout}\n${integrity.stderr}`);
  }
  if (integrity.status === 0) {
    fail("integrity-only must use non-zero exit (PARTIAL)");
  }
  note(`- C --integrity-only reports limited scope: PASS (exit=${integrity.status})`);

  const check = spawnSync(process.execPath, ["scripts/verify-release-archive.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  if (check.status === 0) note("- release-archive canary: PASS");
  else fail(`release-archive failed:\n${check.stdout}\n${check.stderr}`);

  note("");
  note("PASS m10-audit-repro");
  writeFileSync(join(outDir, "external-audit-repro.md"), `${lines.join("\n")}\n`, "utf8");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

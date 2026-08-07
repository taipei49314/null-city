/**
 * Proves that each M8 regression test actually attacks its defect.
 *
 * A regression test that passes both before and after a fix proves nothing.
 * For every P0/P1/P2 fixed in this milestone, this script temporarily restores
 * the exact inherited behaviour, runs the corresponding test file, and asserts
 * that the test now FAILS. A patch whose test still passes is reported as a
 * weak regression — the test is not pinning the fix.
 *
 * This is a reviewer tool, not part of `pnpm verify`: it edits tracked source
 * files. Every edit is restored from an in-memory copy in a `finally` block,
 * and the script re-reads each file at the end to confirm byte-identical
 * restoration before exiting.
 *
 * Usage: node scripts/adversarial/prove-regressions.mjs
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const RPC = join("packages", "server", "src", "rpc.ts");
const HTTP = join("packages", "server", "src", "http.ts");
const ENGINE = join("packages", "simulation", "src", "engine.ts");

/**
 * Each entry reverts one fix to the behaviour inherited from M7 and names the
 * test file that must fail as a result.
 */
const DEFECTS = [
  {
    id: "D1",
    severity: "P0",
    title: "post-completion command mutates the player log and artifact hash",
    pkg: "@null-city/server",
    testFile: "test/adversarial-immutability.test.ts",
    edits: [
      {
        file: RPC,
        find: `  // A completed run is immutable on *every* layer, not just inside the engine.
  // The engine already refuses post-completion commands without emitting truth,
  // but the server used to keep going and append a \`CommandResult\` player
  // event, which moved \`playerLogHash\`, the player event count and therefore
  // the exported artifact hash after the terminal event. Answer here instead,
  // before the verification queue, the engine and the bridge are touched.
  if (record.engine.worldState.phase === "completed") {
    const rejected = record.engine.submitCommand(commandName, { ...rawParams }, idempotencyKey);
    return {
      sessionId,
      commandId: rejected.commandId,
      state: rejected.state,
      etaTick: rejected.etaTick,
      validation: rejected.validation,
      result: rejected.result,
      events: [],
      publicState: publicState(record),
    };
  }

`,
        replace: "",
      },
    ],
  },
  {
    id: "D2",
    severity: "P1",
    title: "REST body sessionId overrides the URL path (confused deputy)",
    pkg: "@null-city/server",
    testFile: "test/adversarial-transport.test.ts",
    edits: [
      { file: HTTP, find: "params: { ...body, sessionId }", replace: "params: { sessionId, ...body }", all: true },
    ],
  },
  {
    id: "D3",
    severity: "P1",
    title: "malformed percent-encoding in the path returns 500",
    pkg: "@null-city/server",
    testFile: "test/adversarial-transport.test.ts",
    edits: [
      {
        file: HTTP,
        find: `      let sessionId: string;
      try {
        sessionId = decodeURIComponent(segments[1]!);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: { code: "invalid_params", message: "session id in the path is not valid percent-encoding" },
        });
      }`,
        replace: `      const sessionId = decodeURIComponent(segments[1]!);`,
      },
    ],
  },
  {
    id: "D4",
    severity: "P1",
    title: "resume accepts a snapshot whose truth log fails its own hash chain",
    pkg: "@null-city/simulation",
    testFile: "test/adversarial-resume.test.ts",
    edits: [
      {
        file: ENGINE,
        find: `  // The embedded truth log must verify against its own hash chain before it is
  // adopted. \`loadSnapshotFromFile\` already did this for the CLI path, but
  // resume is also reachable from the public REST transport, where the caller
  // supplies the snapshot — so the check has to live at the engine boundary
  // that every caller shares.
  const chain = verifyEventStream([...resume.events], {
    expectedSessionId: resume.sessionId,
    requireNonEmpty: resume.tick > 0 || resume.sequence > 0,
  });
  if (!chain.validChain) {
    throw new Error(
      \`snapshot event stream invalid at sequence \${String(chain.brokenAt)} (\${chain.reason ?? "unknown"})\`,
    );
  }
`,
        replace: "",
      },
    ],
  },
  {
    id: "D5",
    severity: "P2",
    title: "an oversized body poisons the keep-alive connection",
    pkg: "@null-city/server",
    testFile: "test/adversarial-transport.test.ts",
    edits: [
      {
        file: HTTP,
        find: `    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }`,
        replace: `    if (size > MAX_BODY_BYTES) {
      throw new BodyError(\`request body exceeds the \${MAX_BODY_BYTES} byte limit\`);
    }`,
      },
    ],
  },
];

const originals = new Map();

function readFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

function remember(relPath) {
  if (!originals.has(relPath)) {
    originals.set(relPath, readFile(relPath));
  }
}

function applyEdits(edits) {
  for (const edit of edits) {
    remember(edit.file);
    const before = readFile(edit.file);
    const occurrences = before.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(`patch target not found in ${edit.file}:\n${edit.find.slice(0, 160)}`);
    }
    if (!edit.all && occurrences > 1) {
      throw new Error(`patch target is ambiguous (${occurrences} matches) in ${edit.file}`);
    }
    const after = edit.all ? before.split(edit.find).join(edit.replace) : before.replace(edit.find, edit.replace);
    writeFileSync(join(REPO_ROOT, edit.file), after, "utf8");
  }
}

function restoreAll() {
  for (const [relPath, contents] of originals) {
    writeFileSync(join(REPO_ROOT, relPath), contents, "utf8");
  }
}

function runTest(pkg, testFile) {
  const result = spawnSync(
    "pnpm",
    ["--filter", pkg, "exec", "vitest", "run", testFile, "--reporter", "basic"],
    { cwd: REPO_ROOT, encoding: "utf8", shell: true },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const failed = /(\d+) failed/.exec(output);
  const passed = /Tests\s+.*?(\d+) passed/.exec(output);
  return {
    status: result.status,
    failedCount: failed ? Number(failed[1]) : 0,
    passedCount: passed ? Number(passed[1]) : 0,
    output,
  };
}

const results = [];

try {
  for (const defect of DEFECTS) {
    process.stdout.write(`\n== ${defect.id} (${defect.severity}) ${defect.title} ==\n`);
    process.stdout.write(`   reverting the fix, then running ${defect.pkg} ${defect.testFile}\n`);
    applyEdits(defect.edits);
    let run;
    try {
      run = runTest(defect.pkg, defect.testFile);
    } finally {
      restoreAll();
    }
    const provesDefect = run.status !== 0 && run.failedCount > 0;
    results.push({
      id: defect.id,
      severity: defect.severity,
      title: defect.title,
      test: `${defect.pkg} ${defect.testFile}`,
      exitCode: run.status,
      failedOnInheritedBehaviour: run.failedCount,
      passedOnInheritedBehaviour: run.passedCount,
      verdict: provesDefect ? "REGRESSION PROVEN" : "WEAK REGRESSION",
    });
    process.stdout.write(
      `   exit=${run.status} failed=${run.failedCount} passed=${run.passedCount} -> ` +
        `${provesDefect ? "REGRESSION PROVEN (test catches the inherited defect)" : "WEAK REGRESSION (test did not fail!)"}\n`,
    );
  }
} finally {
  restoreAll();
}

// Restoration must be byte-exact or the working tree is left corrupted.
let restoreOk = true;
for (const [relPath, contents] of originals) {
  if (readFile(relPath) !== contents) {
    restoreOk = false;
    process.stderr.write(`RESTORE FAILED for ${relPath}\n`);
  }
}

process.stdout.write("\n== summary ==\n");
for (const item of results) {
  process.stdout.write(
    `${item.id} ${item.severity} ${item.verdict} (exit ${item.exitCode}, ${item.failedOnInheritedBehaviour} failing) — ${item.title}\n`,
  );
}
process.stdout.write(`\nsource restoration: ${restoreOk ? "byte-identical" : "FAILED"}\n`);

const weak = results.filter((item) => item.verdict !== "REGRESSION PROVEN");
process.stdout.write(`proven: ${results.length - weak.length}/${results.length}\n`);
process.exitCode = weak.length === 0 && restoreOk ? 0 : 1;

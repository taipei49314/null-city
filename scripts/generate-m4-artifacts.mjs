import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

function fail(message) {
  process.stderr.write(`FAIL generate-m4-artifacts: ${message}\n`);
  process.exit(1);
}

async function main() {
  for (const rel of ["packages/server/dist/index.js", "packages/test-fixtures/dist/index.js"]) {
    if (!existsSync(join(root, rel))) {
      fail(`missing built artifact ${rel}; run pnpm build first`);
    }
  }

  const serverMod = await import(pathToFileURL(join(root, "packages/server/dist/index.js")).href);
  const fixtures = await import(pathToFileURL(join(root, "packages/test-fixtures/dist/index.js")).href);

  const app = serverMod.createServer();
  const port = await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${port}`;
  const api = serverMod.restClient(baseUrl);
  const script = fixtures.goldenScript();

  const outDir = join(root, "data");
  mkdirSync(outDir, { recursive: true });

  try {
    async function complete(sessionId, seed) {
      await api.createSession({ scenarioId: "black-river", seed, sessionId });
      await serverMod.driveScriptOverRest(api, sessionId, script);
      await api.advance(sessionId, 540);
      const response = await fetch(`${baseUrl}/sessions/${sessionId}/artifact`);
      const parsed = await response.json();
      if (!response.ok || !parsed.ok) {
        throw new Error(`artifact export failed: ${JSON.stringify(parsed.error ?? parsed)}`);
      }
      return parsed.result;
    }

    const artifactA = await complete("m4-demo-run-a", 49314);
    const artifactB = await complete("m4-demo-run-b", 100);

    writeFileSync(join(outDir, "m4-run-a.artifact.json"), JSON.stringify(artifactA), { encoding: "utf8" });
    writeFileSync(join(outDir, "m4-run-b.artifact.json"), JSON.stringify(artifactB), { encoding: "utf8" });

    // Keep the Command Center Replay Lab fixture identical to the production export.
    const ccFixture = join(root, "apps/command-center/test/fixtures/sample-run.artifact.json");
    writeFileSync(ccFixture, JSON.stringify(artifactA), { encoding: "utf8" });

    process.stdout.write(
      `PASS generate-m4-artifacts: wrote data/m4-run-a.artifact.json (score=${artifactA.scoreTotal}) and data/m4-run-b.artifact.json (score=${artifactB.scoreTotal})\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

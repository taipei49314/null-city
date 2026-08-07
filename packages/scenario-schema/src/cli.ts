import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assertScenarioSize, parseScenario } from "./index.js";
import { ScenarioCompileError, compileScenario } from "./compile.js";
import { scenarioSchema } from "./index.js";

function usage(): never {
  process.stderr.write(`Usage:
  nullcity-scenario validate <path>
  nullcity-scenario compile <path> --out <path>
  nullcity-scenario inspect <path>
`);
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || !["validate", "compile", "inspect"].includes(command)) {
    usage();
  }
  const path = args[1];
  if (!path) {
    usage();
  }
  const { values } = parseArgs({
    args: args.slice(2),
    options: {
      out: { type: "string" },
    },
  });

  const abs = resolve(path);
  const json = readFileSync(abs, "utf8");
  assertScenarioSize(json);

  try {
    if (command === "validate") {
      const compiled = parseScenario(json);
      process.stdout.write(`PASS validate ${compiled.id} digest=${compiled.digest.slice(0, 16)}\n`);
      return;
    }
    if (command === "inspect") {
      const compiled = parseScenario(json);
      process.stdout.write(
        JSON.stringify(
          {
            id: compiled.id,
            name: compiled.name,
            description: compiled.description ?? null,
            metadata: compiled.metadata ?? null,
            digest: compiled.digest,
            totalTicks: compiled.totalTicks,
            indexes: compiled.indexes,
            schemaVersion: compiled.schemaVersion,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    if (command === "compile") {
      if (!values.out) {
        throw new Error("--out <path> is required for compile");
      }
      const raw = scenarioSchema.parse(JSON.parse(json));
      const compiled = compileScenario(raw);
      const outPath = resolve(values.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(compiled, null, 2), "utf8");
      process.stdout.write(`PASS compile ${compiled.id} -> ${outPath}\n`);
      return;
    }
  } catch (error) {
    if (error instanceof ScenarioCompileError) {
      process.stderr.write("FAIL compile diagnostics:\n");
      for (const d of error.diagnostics) {
        process.stderr.write(`  ${d.path}: ${d.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

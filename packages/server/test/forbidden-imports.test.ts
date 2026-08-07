import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "..", "..");

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return files;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      walk(full, files);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("forbidden public imports", () => {
  it("CLI player does not import simulation or truth stores", () => {
    const source = readFileSync(join(process.cwd(), "src/cli/player.ts"), "utf8");
    expect(source).not.toMatch(/@null-city\/simulation/);
    expect(source).not.toMatch(/TruthEvent|worldState\.districts|eventLog/);
    expect(source).toMatch(/restClient|createServer/);
  });

  it("apps/ packages (if present) must not import simulation", () => {
    const apps = join(ROOT, "apps");
    const files = walk(apps);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["']@null-city\/simulation["']/);
    }
  });
});

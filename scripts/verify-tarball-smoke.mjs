#!/usr/bin/env node
/**
 * `pnpm verify:tarball-smoke` — proves that at least two published-shape
 * packages (`@null-city/contracts`, `@null-city/epistemics`) are genuinely
 * consumable from a real `npm pack` tarball, not just from this workspace's
 * live `dist/` folders.
 *
 * For each package in order:
 *   1. run `npm pack` inside the package directory (respects its "files"
 *      field exactly like a real `npm publish` would);
 *   2. extract the resulting tarball with `tar` (no network access);
 *   3. assert the extracted tree has `dist/index.js` and does NOT leak `src/`;
 *   4. copy it into a shared scratch `node_modules/@null-city/<name>` tree.
 *
 * `@null-city/epistemics` imports `@null-city/contracts` via a bare
 * specifier in its own compiled `dist/store.js` — resolving that import
 * correctly (via the shared scratch node_modules, exactly like a real
 * consumer's install) is what proves the packed tarballs are self-consistent
 * "built exports only" artifacts, not an accident of this repo's live
 * workspace symlinks. No package here has any other production dependency
 * besides `zod`, which is seeded once from this repo's own resolved
 * `node_modules` (dereferencing pnpm's symlink) so the whole check needs no
 * npm-registry network access.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, cpSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const PACKAGES = ["contracts", "epistemics"];

function fail(message) {
  process.stderr.write(`FAIL tarball-smoke: ${message}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
  if (result.status !== 0) {
    fail(
      `${cmd} ${args.join(" ")} exited ${result.status}\n--- stdout ---\n${result.stdout ?? ""}\n--- stderr ---\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

const workDir = mkdtempSync(join(tmpdir(), "null-city-tarball-smoke-"));
const scratchNodeModules = join(workDir, "node_modules");
const scratchScope = join(scratchNodeModules, "@null-city");
mkdirSync(scratchScope, { recursive: true });

try {
  const zodSource = realpathSync(join(root, "packages", "contracts", "node_modules", "zod"));
  cpSync(zodSource, join(scratchNodeModules, "zod"), { recursive: true });

  for (const name of PACKAGES) {
    const pkgDir = join(root, "packages", name);
    if (!existsSync(join(pkgDir, "dist", "index.js"))) {
      fail(`packages/${name}/dist/index.js does not exist — run "pnpm build" before this check`);
    }

    const pack = run("npm", ["pack", "--silent", "--pack-destination", workDir], { cwd: pkgDir });
    const tgzName = pack.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (!tgzName) {
      fail(`npm pack for @null-city/${name} produced no tarball filename (stdout: ${pack.stdout})`);
    }
    const tgzPath = join(workDir, tgzName);
    if (!existsSync(tgzPath)) {
      fail(`expected tarball at ${tgzPath} after npm pack`);
    }

    const extractRoot = join(workDir, `extract-${name}`);
    mkdirSync(extractRoot, { recursive: true });
    run("tar", ["-xzf", tgzPath, "-C", extractRoot]);

    const extracted = join(extractRoot, "package");
    if (!existsSync(join(extracted, "dist", "index.js"))) {
      fail(
        `packed @null-city/${name} tarball is missing dist/index.js — check its "files" field and that dist/ was built before packing`,
      );
    }
    if (existsSync(join(extracted, "src"))) {
      fail(`packed @null-city/${name} tarball leaked src/ — check its "files" field`);
    }

    cpSync(extracted, join(scratchScope, name), { recursive: true });
  }

  for (const name of PACKAGES) {
    const entry = join(scratchScope, name, "dist", "index.js");
    const probe =
      `import * as mod from ${JSON.stringify(pathToFileURL(entry).href)}; ` +
      `if (Object.keys(mod).length === 0) { throw new Error("empty export surface"); } ` +
      `process.stdout.write("OK " + Object.keys(mod).length + "\\n");`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: workDir,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      fail(`importing packed @null-city/${name} from its tarball contents failed:\n${result.stderr}`);
    }
  }

  process.stdout.write(
    `PASS tarball-smoke: npm-packed, extracted, and imported ${PACKAGES.length} package(s) (${PACKAGES.join(", ")}) — dist-only, no leaked src/, bare-specifier workspace imports resolve with no registry network access\n`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./paths.ts";

/**
 * The "old" arm's parser: @wiredown/core as first imported from the
 * Sketchdown fork, before any change
 * from the syntax proposal: `(id=…)`, implicit replacement in variants,
 * `(hi)`, content-sized grids, no per-component option checks. The tag
 * `eval-baseline` points at the same commit.
 */
export const BASELINE_SHA = "c36f5df0a342909c55d06fe2b1b0b2280c33ca91";

const PATHS = [
  "tsconfig.base.json",
  "packages/core/package.json",
  "packages/core/tsconfig.build.json",
  "packages/core/src",
];

export interface BaselineNode {
  type: string;
  text: string;
  id?: string;
  body: string[];
  children: BaselineNode[];
}

/** The part of the baseline core the eval uses. */
export interface BaselineCore {
  resolve(
    source: string,
    options?: { lookup?: (id: string) => string | undefined; known?: () => string[] },
  ): { tree: BaselineNode; errors: { line: number; message: string }[] };
}

export const baselineDir = (cacheRoot = join(REPO, "node_modules/.cache/wiredown-evals")) =>
  join(cacheRoot, `baseline-${BASELINE_SHA.slice(0, 12)}`);

/** Archive the baseline commit's core and compile it with the repo's tsc. */
function build(dir: string): void {
  const found = spawnSync("git", ["cat-file", "-e", `${BASELINE_SHA}^{commit}`], { cwd: REPO });
  if (found.status !== 0) {
    throw new Error(
      `the baseline commit ${BASELINE_SHA} is not in this clone (a shallow clone?); ` +
        `fetch it with "git fetch origin tag eval-baseline" (the tag points at it)`,
    );
  }
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const tar = execFileSync("git", ["archive", "--format=tar", BASELINE_SHA, ...PATHS], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", tmp], { input: tar });
    const tsc = createRequire(join(REPO, "package.json")).resolve("typescript/bin/tsc");
    execFileSync(process.execPath, [tsc, "-p", join(tmp, "packages/core/tsconfig.build.json")], {
      stdio: "pipe",
    });
    try {
      renameSync(tmp, dir);
    } catch (error) {
      // another process finished first
      if (!existsSync(join(dir, "packages/core/dist/index.js"))) throw error;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The compiled baseline core, built into the cache on first use. */
export async function loadBaseline(dir = baselineDir()): Promise<BaselineCore> {
  const entry = join(dir, "packages/core/dist/index.js");
  if (!existsSync(entry)) build(dir);
  return (await import(pathToFileURL(entry).href)) as BaselineCore;
}

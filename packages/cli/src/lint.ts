import { readdir, stat } from "node:fs/promises";
import { join, matchesGlob, relative } from "node:path";
import { checkSource, formatChecked } from "./check";
import type { CheckedFile } from "./check";
import { formatLinted, lintFlowFile } from "./flow";
import type { LintedFlow } from "./flow";
import { CommandError, fileOp, json, readSource, UsageError } from "./output";
import type { Result } from "./output";

export interface LintOptions {
  json?: boolean;
  /** Globs, matched against paths relative to the working directory, to skip. */
  exclude?: string[];
}

/** A path that cannot be read is a usage error: exit 2. */
const readable = <T>(path: string, op: Promise<T>) =>
  fileOp(`cannot read ${path}`, op).catch((error: unknown) => {
    throw error instanceof CommandError ? new UsageError(error.message) : error;
  });

/**
 * Markdown files under each path, skipping node_modules, dot-directories
 * and paths an `exclude` glob matches (an excluded directory is not walked).
 */
async function files(paths: string[], exclude: string[]): Promise<string[]> {
  const excluded = (path: string) => exclude.some((glob) => matchesGlob(relative(".", path), glob));
  async function walk(dir: string): Promise<string[]> {
    const entries = await readable(dir, readdir(dir, { withFileTypes: true }));
    const out: string[] = [];
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(dir, e.name);
      if (excluded(path)) continue;
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...(await walk(path)));
      } else if (e.isFile() && e.name.endsWith(".md")) out.push(path);
    }
    return out;
  }
  const out: string[] = [];
  for (const path of paths) {
    if (excluded(path)) continue;
    const info = await readable(path, stat(path));
    out.push(...(info.isDirectory() ? await walk(path) : [path]));
  }
  return [...new Set(out)];
}

/**
 * The CI check: `check` on every other Markdown file (one with no wiredown
 * block gets `check`'s warning) and `flow lint` on every `*.excalidraw.md`,
 * in one report. Exit 1 on any screen
 * error or flow finding; screen warnings don't fail.
 */
export async function lint(paths: string[], options: LintOptions = {}): Promise<Result> {
  const screens: CheckedFile[] = [];
  const flows: LintedFlow[] = [];
  for (const file of await files(paths.length ? paths : ["."], options.exclude ?? [])) {
    if (file.endsWith(".excalidraw.md")) flows.push(await lintFlowFile(file));
    else screens.push(checkSource(file, await readSource(file)));
  }
  const failed = screens.some((s) => s.errors.length) || flows.some((f) => f.findings.length);
  const exitCode = failed ? 1 : 0;
  if (options.json) return { exitCode, stdout: json({ screens, flows }), stderr: "" };
  const report = formatChecked(screens) + formatLinted(flows);
  return { exitCode, stdout: report || "no screens or flows found\n", stderr: "" };
}

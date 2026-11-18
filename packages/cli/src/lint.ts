import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkSource, formatChecked } from "./check";
import type { CheckedFile } from "./check";
import { formatLinted, lintFlowFile } from "./flow";
import type { LintedFlow } from "./flow";
import { json, readSource, UsageError } from "./output";
import type { Result } from "./output";

export interface LintOptions {
  json?: boolean;
}

/** Markdown files under a directory, skipping node_modules and dot-directories. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...(await walk(path)));
    } else if (e.isFile() && e.name.endsWith(".md")) out.push(path);
  }
  return out;
}

async function files(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      throw new UsageError(`cannot read ${path}: ${error.code ?? String(error)}`);
    });
    out.push(...(info.isDirectory() ? await walk(path) : [path]));
  }
  return [...new Set(out)];
}

/**
 * The CI check: `check` on every Markdown file with a wiredown block and
 * `flow lint` on every `*.excalidraw.md`, in one report. Exit 1 on any screen
 * error or flow finding; screen warnings don't fail.
 */
export async function lint(paths: string[], options: LintOptions = {}): Promise<Result> {
  const screens: CheckedFile[] = [];
  const flows: LintedFlow[] = [];
  for (const file of await files(paths.length ? paths : ["."])) {
    if (file.endsWith(".excalidraw.md")) flows.push(await lintFlowFile(file));
    else {
      const checked = checkSource(file, await readSource(file));
      if (checked.screens.length || checked.errors.length) screens.push(checked);
    }
  }
  const failed = screens.some((s) => s.errors.length) || flows.some((f) => f.findings.length);
  const exitCode = failed ? 1 : 0;
  if (options.json) return { exitCode, stdout: json({ screens, flows }), stderr: "" };
  const report = formatChecked(screens) + formatLinted(flows);
  return { exitCode, stdout: report || "no screens or flows found\n", stderr: "" };
}

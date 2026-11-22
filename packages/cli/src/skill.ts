import { cp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CommandError, fileOp, json, UsageError } from "./output";
import type { Result } from "./output";

/** The agent skill, which the build copies into dist/. */
const BUNDLED = fileURLToPath(new URL("../dist/skills/wiredown", import.meta.url));

export interface SkillOptions {
  json?: boolean;
}

/**
 * Installs the bundled agent skill in `<dir>/.agents/skills/wiredown`,
 * replacing an earlier install, and links it from `.claude/skills` and
 * from every other dot-folder of `dir` that has a `skills` folder.
 */
export async function skill(dir: string, options: SkillOptions = {}): Promise<Result> {
  const entries = await fileOp(`cannot read ${dir}`, readdir(dir, { withFileTypes: true })).catch(
    (error: unknown) => {
      throw error instanceof CommandError ? new UsageError(error.message) : error;
    },
  );
  const installed = join(dir, ".agents", "skills", "wiredown");
  const folders: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(".") || e.name === ".agents") continue;
    const names = await fileOp(`cannot read ${join(dir, e.name)}`, readdir(join(dir, e.name)));
    if (e.name === ".claude" || names.includes("skills")) folders.push(join(dir, e.name, "skills"));
  }
  const links: string[] = [];
  try {
    await fileOp(
      `cannot write ${installed}`,
      (async () => {
        await rm(installed, { recursive: true, force: true });
        await cp(BUNDLED, installed, { recursive: true });
      })(),
    );
    for (const folder of folders) {
      const link = join(folder, "wiredown");
      await fileOp(
        `cannot write ${link}`,
        (async () => {
          await mkdir(folder, { recursive: true });
          await rm(link, { recursive: true, force: true });
          await symlink(relative(folder, installed), link);
        })(),
      );
      links.push(link);
    }
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    return {
      exitCode: 1,
      stdout: options.json
        ? json({ skill: null, links, errors: [{ message: error.message }] })
        : "",
      stderr: options.json ? "" : `wiredown: ${error.message}\n`,
    };
  }
  return {
    exitCode: 0,
    stdout: options.json
      ? json({ skill: installed, links })
      : [installed, ...links.map((link) => `${link} -> ${installed}`)].join("\n") + "\n",
    stderr: "",
  };
}

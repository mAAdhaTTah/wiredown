import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

export const BASE = [
  "# Team members",
  "",
  "```wiredown",
  "window: Team settings",
  "  text: 3 of 5 seats used #seats",
  "  button: *Invite member #invite",
  "```",
  "^team",
].join("\n");

export const VARIANT = [
  "# After",
  "",
  "```wiredown",
  "extends: team",
  "replace: seats",
  "  text: 2 of 5 seats used",
  "```",
  "^team-after",
].join("\n");

/** The `--screens` option naming the `screens.md` in `dir`. */
export const screensIn = (dir: string) => ["--screens", join(dir, "screens.md")];

/** A fresh temp dir with the given files written into it, removed when the test ends. */
export async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wiredown-cli-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

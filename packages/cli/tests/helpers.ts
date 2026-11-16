import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** A fresh temp dir with the given files written into it. */
export async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wiredown-cli-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

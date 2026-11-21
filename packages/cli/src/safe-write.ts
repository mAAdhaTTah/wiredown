import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CommandError } from "./output";

/**
 * Refuse stale edits and replace the target atomically on its filesystem.
 * Best effort: a save that lands between the check and the rename is lost.
 */
export async function safeWrite(path: string, original: string, text: string): Promise<void> {
  const changed = new CommandError(
    `${path} changed while the command was running, so it was not written. Close the drawing in Obsidian, or run the command again.`,
  );
  // a symlink keeps pointing at its file, which is the one replaced
  const target = await realpath(path).catch(() => Promise.reject(changed));
  const temporary = join(dirname(target), `.wiredown-${randomUUID()}`);
  try {
    await writeFile(temporary, text, { flag: "wx", mode: (await stat(target)).mode & 0o777 });
    if (!(await readFile(target)).equals(Buffer.from(original))) throw changed;
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

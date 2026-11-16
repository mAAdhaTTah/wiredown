import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Refuse stale edits and replace the target atomically on its filesystem. */
export async function safeWrite(path: string, original: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.wiredown-${randomUUID()}`);
  const staged = await open(temporary, "wx");
  try {
    await staged.writeFile(text);
    await staged.close();
    if (!(await readFile(path)).equals(Buffer.from(original))) {
      throw new Error(
        `${path} changed while the command was running; nothing was written. Close the drawing in Obsidian, or run the command again.`,
      );
    }
    await rename(temporary, path);
  } finally {
    await staged.close();
    await rm(temporary, { force: true });
  }
}

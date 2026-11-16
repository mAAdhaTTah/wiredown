import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Refuse stale edits and replace the target atomically on its filesystem. */
export async function safeWrite(path: string, original: string, text: string): Promise<void> {
  const temporary = await mkdtemp(join(dirname(path), ".wiredown-"));
  try {
    const staged = join(temporary, "content");
    await writeFile(staged, text);
    if (!(await readFile(path)).equals(Buffer.from(original))) {
      throw new Error(
        `${path} changed while the command was running; nothing was written. Close the drawing in Obsidian, or run the command again.`,
      );
    }
    await rename(staged, path);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

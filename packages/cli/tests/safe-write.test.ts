import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import * as fs from "node:fs/promises";
import { safeWrite } from "../src/safe-write.js";
import { run } from "../src/index.js";
import { BASE, fixture } from "./helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

test("atomic replacement cleans up, and stale edits preserve the directory", async () => {
  const dir = await fixture({ "drawing.md": "original", "other.md": "untouched" });
  const file = join(dir, "drawing.md");
  const entries = await readdir(dir);
  await safeWrite(file, "original", "replacement");
  expect(await readFile(file, "utf8")).toBe("replacement");
  expect(await readdir(dir)).toEqual(entries);
  await expect(safeWrite(file, "original", "stale")).rejects.toThrow(
    `${file} changed while the command was running; nothing was written. Close the drawing in Obsidian, or run the command again.`,
  );
  expect(await readFile(file, "utf8")).toBe("replacement");
  expect(await readFile(join(dir, "other.md"), "utf8")).toBe("untouched");
  expect(await readdir(dir)).toEqual(entries);
});

test("add-screen refuses a concurrent Obsidian save", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
  const original = await readFile(file, "utf8");
  const newer = original + "\nHuman save\n";
  const read = (await vi.importActual<typeof fs>("node:fs/promises")).readFile;
  let reads = 0;
  const spy = vi.spyOn(fs, "readFile").mockImplementation((async (
    ...args: Parameters<typeof read>
  ) => {
    if (args[0] === file && ++reads === 2) await writeFile(file, newer);
    return read(...args);
  }) as typeof read);
  try {
    const result = await run(["flow", "add-screen", file, "team"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("changed while the command was running; nothing was written.");
    expect(await read(file, "utf8")).toBe(newer);
  } finally {
    spy.mockRestore();
  }
});

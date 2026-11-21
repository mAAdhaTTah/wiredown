import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { run } from "../src/index";
import { safeWrite } from "../src/safe-write";
import { BASE, fixture } from "./helpers";

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
    `${file} changed while the command was running, so it was not written. Close the drawing in Obsidian, or run the command again.`,
  );
  expect(await readFile(file, "utf8")).toBe("replacement");
  expect(await readFile(join(dir, "other.md"), "utf8")).toBe("untouched");
  expect(await readdir(dir)).toEqual(entries);
});

test("add-screen refuses a concurrent Obsidian save", async () => {
  const dir = await realpath(await fixture({ "screens.md": BASE }));
  const file = join(dir, "a.excalidraw.md");
  expect(
    (await run(["flow", "new", file, "team", "--screens", join(dir, "screens.md")])).exitCode,
  ).toBe(0);
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
    const result = await run([
      "flow",
      "add-screen",
      file,
      "team",
      "--screens",
      join(dir, "screens.md"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "changed while the command was running, so it was not written.",
    );
    expect(await read(file, "utf8")).toBe(newer);
  } finally {
    spy.mockRestore();
  }
});

test("keeps the file's mode, writes through a symlink, and reports a deleted file", async () => {
  const { chmod, lstat, rm, stat, symlink } = await import("node:fs/promises");
  const dir = await fixture({ "drawing.md": "original" });
  const file = join(dir, "drawing.md");
  await chmod(file, 0o600);
  const link = join(dir, "link.md");
  await symlink(file, link);
  await safeWrite(link, "original", "replacement");
  expect(await readFile(file, "utf8")).toBe("replacement");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  await rm(file);
  await expect(safeWrite(file, "replacement", "x")).rejects.toThrow(/changed while the command/);
  expect(await readdir(dir)).toEqual(["link.md"]);
});

test("flow new leaves no drawing behind when the screens file changes", async () => {
  const dir = await realpath(await fixture({ "screens.md": BASE }));
  const screens = join(dir, "screens.md");
  const file = join(dir, "a.excalidraw.md");
  const read = (await vi.importActual<typeof fs>("node:fs/promises")).readFile;
  let reads = 0;
  const spy = vi.spyOn(fs, "readFile").mockImplementation((async (
    ...args: Parameters<typeof read>
  ) => {
    if (args[0] === screens && ++reads === 2) await writeFile(screens, BASE + "\nHuman save\n");
    return read(...args);
  }) as typeof read);
  try {
    const result = await run(["flow", "new", file, "team", "--screens", join(dir, "screens.md")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "changed while the command was running, so it was not written.",
    );
    expect(await readdir(dir)).toEqual(["screens.md"]);
    // so running it again works
    spy.mockRestore();
    expect(
      (await run(["flow", "new", file, "team", "--screens", join(dir, "screens.md")])).exitCode,
    ).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

for (const command of ["new", "add-screen"]) {
  test(`${command} preserves a concurrent flow save during screens rollback`, async () => {
    const dir = await realpath(await fixture({ "screens.md": BASE }));
    const screens = join(dir, "screens.md");
    const file = join(dir, "a.excalidraw.md");
    if (command === "add-screen")
      expect(
        (await run(["flow", "new", file, "team", "--screens", join(dir, "screens.md")])).exitCode,
      ).toBe(0);
    await writeFile(screens, BASE);
    const read = (await vi.importActual<typeof fs>("node:fs/promises")).readFile;
    let reads = 0;
    const newer = "Concurrent flow save";
    const spy = vi.spyOn(fs, "readFile").mockImplementation((async (
      ...args: Parameters<typeof read>
    ) => {
      if (args[0] === screens && ++reads === 2) {
        await writeFile(screens, BASE + "\nHuman save\n");
        await writeFile(file, newer);
      }
      return read(...args);
    }) as typeof read);
    try {
      const result = await run(["flow", command, file, "team", "--screens", screens]);
      expect(result.exitCode).toBe(1);
      // names both files: why the screens file was not written, and the flow's state
      expect(result.stderr).toContain(
        `${screens} changed while the command was running, so it was not written.`,
      );
      expect(result.stderr).toContain(
        `Another program also changed ${file}, so it was left as it is, with the new frames.`,
      );
      expect(await read(file, "utf8")).toBe(newer);
      expect(await read(screens, "utf8")).toBe(BASE + "\nHuman save\n");
    } finally {
      spy.mockRestore();
    }
  });
}

test("options before a flow subcommand select its help", async () => {
  const result = await run(["flow", "--json", "new"]);
  const expected = await run(["flow", "new", "--help"]);
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(expected.stdout);
});

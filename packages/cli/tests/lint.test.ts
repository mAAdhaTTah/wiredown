import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, screensIn } from "./helpers";

const BAD = "# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad\n";
const grow = (s: string) => s.replace("```\n^team", "  text: One more line\n```\n^team");

/** a/ clean screens and flow, b/ a flow gone stale, c/ a screens error, and skipped places. */
async function tree() {
  const dir = await fixture({ "notes.md": "# Notes\n\nNo wiredown here.\n" });
  for (const sub of ["a", "b", "c", "node_modules/pkg", ".hidden"])
    await mkdir(join(dir, sub), { recursive: true });
  await writeFile(join(dir, "a/screens.md"), BASE);
  await writeFile(join(dir, "b/screens.md"), BASE);
  await writeFile(join(dir, "c/screens.md"), BAD);
  await writeFile(join(dir, "node_modules/pkg/screens.md"), BAD);
  await writeFile(join(dir, ".hidden/screens.md"), BAD);
  for (const sub of ["a", "b"])
    expect(
      (
        await run([
          "flow",
          "new",
          join(dir, sub, "flows/f.excalidraw.md"),
          "team",
          ...screensIn(join(dir, sub)),
        ])
      ).exitCode,
    ).toBe(0);
  const b = join(dir, "b/screens.md");
  await writeFile(b, grow(await readFile(b, "utf8")));
  return dir;
}

test("lint walks a tree: screens and flows in one report", async () => {
  const dir = await tree();
  const result = await run(["lint", dir]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  const lines = result.stdout.replaceAll(dir + "/", "").split("\n");
  expect(lines).toEqual([
    "a/screens.md: 1 screen, 0 errors, 0 warnings",
    "b/screens.md: 1 screen, 0 errors, 0 warnings",
    expect.stringMatching(/^c\/screens\.md:4: \^bad: error: /),
    "c/screens.md: 1 screen, 1 error, 0 warnings",
    "a/flows/f.excalidraw.md: 0 errors",
    expect.stringMatching(/^b\/flows\/f\.excalidraw\.md: F1: error: stale embed size: /),
    "b/flows/f.excalidraw.md: 1 error",
    "",
  ]);
  const json = JSON.parse((await run(["lint", dir, "--json"])).stdout);
  expect(Object.keys(json)).toEqual(["screens", "flows"]);
  expect(json.screens.map((s: { file: string }) => s.file)).toEqual(
    ["a", "b", "c"].map((s) => join(dir, s, "screens.md")),
  );
  expect(json.screens[0]).toEqual({
    file: join(dir, "a/screens.md"),
    screens: [{ id: "team", heading: "Team members", line: expect.any(Number) }],
    errors: [],
    warnings: [],
  });
  expect(json.flows).toEqual([
    { file: join(dir, "a/flows/f.excalidraw.md"), findings: [] },
    {
      file: join(dir, "b/flows/f.excalidraw.md"),
      findings: [
        expect.objectContaining({ frame: "F1", message: expect.stringContaining("stale") }),
      ],
    },
  ]);
});

test("lint passes when clean, warnings don't fail, and defaults to .", async () => {
  const dir = await tree();
  const a = join(dir, "a");
  await writeFile(join(a, "more.md"), "```wiredown\nbutton: Save\n```\n");
  const result = await run(["lint", a, join(dir, "notes.md")]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`${join(a, "more.md")}:2: warning: screen has no ^id`);
  expect(result.stdout).not.toContain("notes.md");
  const cwd = process.cwd();
  process.chdir(a);
  try {
    const here = await run(["lint"]);
    expect(here.exitCode).toBe(0);
    expect(here.stdout).toContain("screens.md: 1 screen, 0 errors, 0 warnings\n");
    expect(here.stdout).toContain(`${join("flows", "f.excalidraw.md")}: 0 errors\n`);
  } finally {
    process.chdir(cwd);
  }
  expect(await run(["lint", join(dir, "notes.md")])).toEqual({
    exitCode: 0,
    stdout: "no screens or flows found\n",
    stderr: "",
  });
  expect(JSON.parse((await run(["lint", join(dir, "notes.md"), "--json"])).stdout)).toEqual({
    screens: [],
    flows: [],
  });
  const missing = await run(["lint", join(dir, "nope")]);
  expect(missing.exitCode).toBe(2);
  expect(missing.stderr).toContain("cannot read");
});

test.skipIf(process.getuid?.() === 0)("exits 2 on a directory it cannot read", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const locked = join(dir, "locked");
  await mkdir(locked);
  await chmod(locked, 0o000);
  try {
    const result = await run(["lint", dir]);
    expect(result).toMatchObject({ exitCode: 2, stdout: "" });
    expect(result.stderr).toContain(`cannot read ${locked}: permission denied`);
  } finally {
    await chmod(locked, 0o755);
  }
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { run } from "../src/index.js";
import { BASE, VARIANT, fixture } from "./helpers.js";
test("new, add, styling idempotence and hand edits", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows/a.excalidraw.md");
  const first = await run(["flow", "new", file, "team", "team-after", "team", "--json"]);
  expect(first.exitCode).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    flow: file,
    frames: [{ frame: "F1" }, { frame: "F2" }, { frame: "F3" }],
    screensFileUpdated: true,
  });
  const styled = await readFile(join(dir, "screens.md"), "utf8");
  expect(styled).toContain("excalidraw-font: Helvetica");
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[1].x = 777;
  flow.elements.push({ ...flow.elements[0], id: "handedit", text: "Human", rawText: "Human" });
  await writeFile(file, serializeFlow(flow));
  const added = await run(["flow", "add-screen", file, "team-after", "--below", "F1", "--json"]);
  expect(added.exitCode).toBe(0);
  expect(JSON.parse(added.stdout)).toMatchObject({
    frames: [{ frame: "F4", x: 777 }],
    screensFileUpdated: false,
  });
  expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(styled);
  const after = parseFlow(await readFile(file, "utf8"));
  expect(after.elements.slice(0, flow.elements.length)).toEqual(flow.elements);
  for (const args of [
    ["new", file],
    ["add-screen", file, "missing"],
    ["add-screen", file, "team", "--below", "F99"],
  ]) {
    expect((await run(["flow", ...args])).exitCode).toBe(1);
  }
  expect(
    (await run(["flow", "add-screen", file, "team", "--below", "F1", "--right-of", "F2"])).exitCode,
  ).toBe(2);
});
test("discovery, explicit path, errors, and empty drawings", async () => {
  const dir = await fixture({
    "screens.md": BASE,
    "bad.md": "# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad",
  });
  await mkdir(join(dir, "nested"));
  for (const [name, extra] of [
    ["own", []],
    ["explicit", ["--screens", join(dir, "screens.md")]],
  ] as const) {
    expect(
      (await run(["flow", "new", join(dir, name + ".excalidraw.md"), "team", ...extra])).exitCode,
    ).toBe(0);
  }
  expect(
    (
      await run([
        "flow",
        "new",
        join(dir, "nested/bad.excalidraw.md"),
        "bad",
        "--screens",
        join(dir, "bad.md"),
      ])
    ).exitCode,
  ).toBe(1);
  const missing = await run(["flow", "new", join(dir, "nested/deep/a.excalidraw.md"), "team"]);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain("nested/screens.md");
  expect(missing.stderr).toContain("deep/screens.md");
  expect((await run(["flow", "new", join(dir, "empty.excalidraw.md")])).exitCode).toBe(0);
});

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

test("empty frontmatter is filled without adding a second block", async () => {
  const { styleScreens } = await import("../src/flow.js");
  const source = "---\n---\n" + BASE;
  expect(styleScreens(source).match(/^---$/gm)).toHaveLength(2);
});

test.each([
  ["none", "", true],
  ["empty", "---\n---\n", true],
  ["unrelated", "---\ntags: [example]\n---\n", true],
  ["font", "---\nexcalidraw-font: Custom\n---\n", true],
  ["css", "---\nexcalidraw-css: custom\n---\n", true],
  ["both", "---\nexcalidraw-font: Custom\nexcalidraw-css: custom\n---\n", false],
  ["crlf", "---\r\ntags: [example]\r\n---\r\n", true],
])("frontmatter: %s", async (_name, prefix, changed) => {
  const { styleScreens } = await import("../src/flow.js");
  const nl = String(prefix).includes("\r\n") ? "\r\n" : "\n";
  const source = prefix + BASE.replace(/\n/g, nl);
  const styled = styleScreens(source);
  expect(styleScreens(styled)).toBe(styled);
  expect(styled.match(/^---\r?$/gm)).toHaveLength(2);
  expect(styled).toContain("excalidraw-font:");
  expect(styled).toContain("excalidraw-css:");
  expect(styled.endsWith(BASE.replace(/\n/g, nl))).toBe(true);
  if (String(prefix).includes("tags:")) expect(styled).toContain("tags: [example]");
  if (String(prefix).includes("Custom")) expect(styled).toContain("excalidraw-font: Custom");
  if (nl === "\r\n") expect(styled.replace(/\r\n/g, "")).not.toContain("\n");
  const dir = await fixture({ "screens.md": source });
  const file = join(dir, "flows/a.excalidraw.md");
  const result = await run(["flow", "new", file, "team", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).screensFileUpdated).toBe(changed);
  expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(styled);
  expect(parseFlow(await readFile(file, "utf8")).embeds.size).toBe(1);
  if (!changed) expect(styled).toBe(source);
});

test.each(["unknown-screen", "unknown-frame", "bad-block", "later-id", "missing-flow"])(
  "failure writes nothing: %s",
  async (kind) => {
    const source = BASE + "\n\n# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad";
    const dir = await fixture({ "screens.md": source });
    const file = join(dir, "flows/a.excalidraw.md");
    await run(["flow", "new", file]);
    const before = await readFile(file, "utf8");
    const target =
      kind === "later-id"
        ? join(dir, "absent/new.excalidraw.md")
        : kind === "missing-flow"
          ? join(dir, "missing.excalidraw.md")
          : file;
    const args =
      kind === "later-id"
        ? ["new", target, "team", "teem"]
        : [
            "add-screen",
            target,
            kind === "bad-block" ? "bad" : kind === "unknown-screen" ? "teem" : "team",
            ...(kind === "unknown-frame" ? ["--right-of", "F99"] : []),
          ];
    const result = await run(["flow", ...args, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const errors = JSON.parse(result.stdout).errors;
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(Object.keys(error).every((key) => ["message", "screen", "line"].includes(key))).toBe(
        true,
      );
      expect(error.message).toEqual(expect.any(String));
    }
    if (kind === "unknown-screen" || kind === "later-id")
      expect(errors).toEqual([
        {
          message: 'no screen "^teem" (it has ^team, ^bad); did you mean "^team"?',
          screen: "teem",
        },
      ]);
    if (kind === "unknown-frame")
      expect(errors[0].message).toContain('unknown frame "F99" (frames: none)');
    if (kind === "bad-block") {
      expect(errors[0]).toMatchObject({ screen: "bad", line: expect.any(Number) });
      const human = await run(["flow", ...args]);
      expect(human.stderr).toContain(
        join(dir, "screens.md") + ":" + errors[0].line + ": ^bad: error: " + errors[0].message,
      );
    }
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(source);
    if (kind === "later-id")
      await expect(readFile(join(dir, "absent"))).rejects.toMatchObject({ code: "ENOENT" });
    if (kind === "missing-flow")
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test.each(["parent", "own", "both", "explicit", "neither"])(
  "screen discovery: %s",
  async (kind) => {
    const dir = await fixture({ "explicit.md": BASE });
    await mkdir(join(dir, "flows"));
    if (kind === "parent" || kind === "both") await writeFile(join(dir, "screens.md"), BASE);
    if (kind === "own" || kind === "both")
      await writeFile(join(dir, "flows/screens.md"), kind === "both" ? "wrong" : BASE);
    const file = join(dir, "flows/a.excalidraw.md");
    const result = await run([
      "flow",
      "new",
      file,
      "team",
      ...(kind === "explicit" ? ["--screens", join(dir, "explicit.md")] : []),
      "--json",
    ]);
    if (kind === "neither") {
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).errors[0].message).toBe(
        "no screens file; tried " +
          join(dir, "screens.md") +
          " and " +
          join(dir, "flows/screens.md"),
      );
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).frames[0].screen).toBe("team");
      expect(parseFlow(await readFile(file, "utf8")).embeds.size).toBe(1);
      const picked =
        kind === "explicit" ? "explicit.md" : kind === "own" ? "flows/screens.md" : "screens.md";
      expect(await readFile(join(dir, picked), "utf8")).toContain("excalidraw-font:");
      if (kind === "both")
        expect(await readFile(join(dir, "flows/screens.md"), "utf8")).toBe("wrong");
    }
  },
);

test.each([[], ["--right-of", "F1"], ["--below", "F1"], ["--title", "Custom"]])(
  "placement and human output %j",
  async (...flags: string[]) => {
    const dir = await fixture({ "screens.md": BASE });
    const file = join(dir, "flows/a.excalidraw.md");
    await run(["flow", "new", file, "team"]);
    const before = parseFlow(await readFile(file, "utf8"));
    before.elements[1].x = 777;
    before.elements[1].y = 55;
    before.elements.push({
      ...before.elements[0],
      id: "human123",
      text: "Human",
      rawText: "Human",
    });
    await writeFile(file, serializeFlow(before));
    const result = await run(["flow", "add-screen", file, "team", ...flags]);
    expect(result.exitCode).toBe(0);
    const after = parseFlow(await readFile(file, "utf8"));
    const image = after.elements.at(-1)!;
    expect(result.stdout).toBe("F2  team  " + image.width + "x" + image.height + "\n");
    expect(after.elements.slice(0, before.elements.length)).toEqual(before.elements);
    expect(image).toMatchObject({
      x: flags.includes("--below") ? 777 : 777 + Number(before.elements[1].width) + 340,
      y: flags.includes("--below") ? 55 + Number(before.elements[1].height) + 340 : 55,
    });
    expect(after.elements.at(-2)!.text).toBe(
      "F2 · " + (flags.includes("--title") ? "Custom" : "Team members"),
    );
  },
);

test("new creates empty drawings and a measured row, preserving existing files", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const empty = join(dir, "empty/a.excalidraw.md");
  const result = await run(["flow", "new", empty, "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ flow: empty, frames: [], screensFileUpdated: false });
  expect(parseFlow(await readFile(empty, "utf8")).elements).toEqual([]);
  const file = join(dir, "flows/row.excalidraw.md");
  const row = await run(["flow", "new", file, "team", "team-after", "team", "--json"]);
  expect(row.exitCode).toBe(0);
  const frames = JSON.parse(row.stdout).frames;
  expect(frames).toHaveLength(3);
  const { checkScreens, layoutScreen } = await import("@wiredown/core");
  const { embedSize, screenElements } = await import("@wiredown/excalidraw");
  let x = 0;
  for (const [i, id] of ["team", "team-after", "team"].entries()) {
    const screen = checkScreens(BASE + "\n" + VARIANT).screens.find((s) => s.id === id)!;
    const rendered = screenElements(layoutScreen(screen.tree));
    const size = embedSize(rendered.width, rendered.height).image;
    expect(frames[i]).toEqual({
      frame: "F" + (i + 1),
      screen: id,
      title: screen.heading,
      x,
      y: 0,
      ...size,
    });
    x += size.width + 340;
  }
  expect(parseFlow(await readFile(file, "utf8")).embeds.size).toBe(3);
  const before = await readFile(file, "utf8");
  const duplicate = await run(["flow", "new", file]);
  expect(duplicate.exitCode).toBe(1);
  expect(duplicate.stderr).toContain("flow already exists:");
  expect(await readFile(file, "utf8")).toBe(before);
  const conflict = await run([
    "flow",
    "add-screen",
    file,
    "team",
    "--right-of",
    "F1",
    "--below",
    "F1",
  ]);
  expect(conflict.exitCode).toBe(2);
  expect(conflict.stdout).toBe("");
  expect(conflict.stderr).toContain("mutually exclusive");
  expect(await readFile(file, "utf8")).toBe(before);
});

test("title falls back to id without a heading", async () => {
  const dir = await fixture({ "screens.md": "```wiredown\nbutton: Save\n```\n^plain" });
  const file = join(dir, "a.excalidraw.md");
  await run(["flow", "new", file]);
  const result = await run(["flow", "add-screen", file, "plain", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).frames[0]).toMatchObject({ title: "plain", screen: "plain" });
  expect(parseFlow(await readFile(file, "utf8")).elements[0].text).toBe("F1 · plain");
});

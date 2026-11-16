import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, VARIANT } from "./helpers";

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
  // with no vault or repository, discovery stops at the parent of the flow's folder
  const deep = join(dir, "nested/deep/a.excalidraw.md");
  const missing = await run(["flow", "new", deep, "team"]);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain(
    `no screens.md was found from ${join(dir, "nested/deep")} upward`,
  );
  expect((await run(["flow", "new", join(dir, "empty.excalidraw.md")])).exitCode).toBe(0);
});

test("empty frontmatter is filled without adding a second block", async () => {
  const { styleScreens } = await import("../src/flow");
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
  const { styleScreens } = await import("../src/flow");
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
      expect(errors[0].message).toContain('unknown node "F99" (nodes: none)');
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
        "no screens.md was found from " + join(dir, "flows") + " upward",
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
  expect(JSON.parse(result.stdout)).toEqual({
    flow: empty,
    frames: [],
    arrows: [],
    screensFileUpdated: false,
  });
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

const embedPaths = async (file: string) =>
  [...parseFlow(await readFile(file, "utf8")).embeds.values()].map((e) => e.path);

test.each(["git", "vault", "flows", "neither"])(
  "the embed is the screens file's path from the root: %s",
  async (kind) => {
    const dir = await fixture({});
    const flows = kind === "neither" ? "a/b/c" : "a/b/flows";
    await mkdir(join(dir, flows), { recursive: true });
    await writeFile(join(dir, "a/b/screens.md"), BASE);
    await writeFile(join(dir, "a/ui.md"), BASE);
    // git wins over a vault nearer the flow
    if (kind === "git") await writeFile(join(dir, ".git"), "gitdir: elsewhere\n");
    if (kind === "git" || kind === "vault") await mkdir(join(dir, "a/.obsidian"));
    const from = kind === "git" ? "a/b/" : kind === "vault" ? "b/" : "";
    const file = join(dir, flows, "x.excalidraw.md");
    expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
    expect(await embedPaths(file)).toEqual([`${from}screens`]);
    // --screens takes any .md file in the root, beside the flow or not
    const ui = await run(["flow", "add-screen", file, "team", "--screens", join(dir, "a/ui.md")]);
    if (kind === "flows" || kind === "neither") {
      expect(ui.stderr).toContain(`the screens file ${join(dir, "a/ui.md")} points outside`);
    } else {
      expect(ui.exitCode).toBe(0);
      expect(await embedPaths(file)).toEqual([`${from}screens`, `${from.slice(0, -2)}ui`]);
    }
  },
);

test("a flow folder linked into a repository: the repository is the root", async () => {
  const dir = await fixture({});
  const repo = join(dir, "repo");
  await mkdir(join(repo, "spec/flows"), { recursive: true });
  await writeFile(join(repo, ".git"), "gitdir: elsewhere\n");
  await writeFile(join(repo, "spec/screens.md"), BASE);
  await symlink(join(repo, "spec/flows"), join(dir, "linked"));
  const file = join(dir, "linked/x.excalidraw.md");
  expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
  expect(await embedPaths(file)).toEqual(["spec/screens"]);
  // and from the repository's side of the link
  const { embedRoot } = await import("../src/embeds");
  expect(await embedRoot(join(repo, "spec/flows/x.excalidraw.md"))).toEqual(await embedRoot(file));
});

test("a flow file linked into a repository: the repository is the root", async () => {
  const dir = await fixture({});
  const repo = join(dir, "repo");
  await mkdir(join(repo, "spec/flows"), { recursive: true });
  await mkdir(join(dir, "links"));
  await writeFile(join(repo, ".git"), "");
  await writeFile(join(repo, "spec/screens.md"), BASE);
  const real = join(repo, "spec/flows/x.excalidraw.md");
  expect((await run(["flow", "new", real])).exitCode).toBe(0);
  const file = join(dir, "links/x.excalidraw.md");
  await symlink(real, file);
  expect((await run(["flow", "add-screen", file, "team"])).exitCode).toBe(0);
  expect(await embedPaths(real)).toEqual(["spec/screens"]);
});

test("a screens file whose path would end the embed link early is refused", async () => {
  const dir = await fixture({});
  await writeFile(join(dir, ".git"), "");
  for (const name of ["a#b", "a|b", "a]b"]) {
    await mkdir(join(dir, name));
    await writeFile(join(dir, name, "screens.md"), BASE);
    const file = join(dir, name, "flows/x.excalidraw.md");
    for (const screens of [[], ["--screens", join(dir, name, "screens.md")]]) {
      const result = await run(["flow", "new", file, "team", ...screens]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `${join(dir, name, "screens.md")}: a screens file's path cannot contain #, | or ], which end the path in an embed link`,
      );
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }
});

test("--screens must be a .md file inside the root", async () => {
  const dir = await fixture({ "screens.md": BASE, "screens.txt": BASE });
  await mkdir(join(dir, "repo/flows"), { recursive: true });
  await writeFile(join(dir, "repo/.git"), "");
  const file = join(dir, "repo/flows/a.excalidraw.md");
  for (const [screens, error] of [
    ["screens.md", `points outside ${join(dir, "repo")}`],
    ["screens.txt", "is not a .md file"],
  ]) {
    const result = await run(["flow", "new", file, "team", "--screens", join(dir, screens)]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`the screens file ${join(dir, screens)} ${error}`);
  }
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("reading an embed: ./ and ../, the path from the root, then a unique suffix", async () => {
  const { embedRoot, resolveEmbed } = await import("../src/embeds");
  const dir = await fixture({});
  await writeFile(join(dir, ".git"), "");
  for (const path of [
    "screens.md",
    "a/screens.md",
    "a/checkout/screens.md",
    "b/checkout/screens.md",
    "a/flows/ui.md",
    "node_modules/x/ui.md",
    ".hidden/ui.md",
  ]) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), BASE);
  }
  const flow = join(dir, "a/flows/x.excalidraw.md");
  const root = await embedRoot(flow);
  const read = async (path: string) => {
    const found = await resolveEmbed(flow, path, root);
    return "path" in found ? [found.path.slice(dir.length + 1), found.embedPath] : found.why;
  };
  expect(await read("../screens")).toEqual(["a/screens.md", "a/screens"]);
  expect(await read("./ui.md")).toEqual(["a/flows/ui.md", "a/flows/ui"]);
  expect(await read("./screens")).toBe(
    `but no ./screens.md was found from ${join(dir, "a/flows")}`,
  );
  expect(await read("../../../outside")).toBe(`which points outside ${dir}`);
  // the path from the root wins over the files it is a suffix of
  expect(await read("screens")).toEqual(["screens.md", "screens"]);
  expect(await read("a/checkout/screens")).toEqual(["a/checkout/screens.md", "a/checkout/screens"]);
  // node_modules, dot folders and folders that cannot be read are not searched
  await mkdir(join(dir, "locked"), { mode: 0 });
  expect(await read("ui")).toEqual(["a/flows/ui.md", "a/flows/ui"]);
  expect(await read("a/screens")).toEqual(["a/screens.md", "a/screens"]);
  expect(await read("checkout/screens")).toBe(
    `but it matches several files: a/checkout/screens.md, b/checkout/screens.md; name one by its path from ${dir}`,
  );
  expect(await read("nope")).toBe(`but no nope.md was found in ${dir}`);
});

test.each(["vault", "git", "neither"])(
  "the documented layout works and nothing above the root is used: %s",
  async (kind) => {
    const dir = await fixture({ "screens.md": BASE });
    const repo = join(dir, "repo");
    await mkdir(join(repo, "spec/flows"), { recursive: true });
    if (kind === "vault") await mkdir(join(repo, ".obsidian"));
    if (kind === "git") await writeFile(join(repo, ".git"), "gitdir: elsewhere\n");
    const root = kind === "neither" ? join(repo, "spec") : repo;
    const file = join(repo, "spec/flows/a.excalidraw.md");
    // dir/screens.md is above the root: never found
    const above = await run(["flow", "new", file, "team"]);
    expect(above.exitCode).toBe(1);
    expect(above.stderr).toContain(
      `no screens.md was found from ${join(repo, "spec/flows")} upward`,
    );
    const outside = await run(["flow", "new", file, "team", "--screens", join(dir, "screens.md")]);
    expect(outside.exitCode).toBe(1);
    expect(outside.stderr).toContain(
      `the screens file ${join(dir, "screens.md")} points outside ${root}`,
    );
    // a symlink inside the root that leaves it is outside too
    await symlink(join(dir, "screens.md"), join(repo, "spec/screens.md"));
    expect((await run(["flow", "new", file, "team"])).stderr).toContain(`points outside ${root}`);
    await rm(join(repo, "spec/screens.md"));
    await writeFile(join(repo, "spec/screens.md"), BASE);
    expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
    expect(await embedPaths(file)).toEqual([kind === "neither" ? "screens" : "spec/screens"]);
  },
);

test.each([
  ["add-screen", "team"],
  ["decision", "Choice"],
  ["connect", "F1", "F1"],
  ["note", "F1", "Note"],
])("%s refuses newer live metadata before writing", async (...args) => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[0].customData = { wiredown: { v: 2 } };
  const source = serializeFlow(flow);
  await writeFile(file, source);
  const screens = await readFile(join(dir, "screens.md"), "utf8");
  const result = await run(["flow", args[0], file, ...args.slice(1)]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    `${file}: this drawing was written by a newer wiredown (data version 2); upgrade wiredown to edit it`,
  );
  expect(await readFile(file, "utf8")).toBe(source);
  expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(screens);
});

test.each([2, "2"])("add-screen refuses unsupported version %s as JSON", async (v) => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  await run(["flow", "new", file, "team"]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[0].customData = { wiredown: { v } };
  await writeFile(file, serializeFlow(flow));
  const result = await run(["flow", "add-screen", file, "team", "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    flow: file,
    errors: [{ message: expect.stringContaining("data version") }],
  });
});

test("add-screen ignores deleted newer metadata", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  await run(["flow", "new", file, "team"]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements.push({
    ...flow.elements[0],
    id: "deleted1",
    isDeleted: true,
    customData: { wiredown: { v: 2 } },
  });
  await writeFile(file, serializeFlow(flow));
  expect((await run(["flow", "add-screen", file, "team"])).exitCode).toBe(0);
});

test("paths found from a relative flow path print relative to the working directory", async () => {
  const dir = await realpath(
    await fixture({ "screens.md": "# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad" }),
  );
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const result = await run(["flow", "new", "flows/a.excalidraw.md", "bad"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^screens\.md:4: \^bad: error: /);
    // a path given absolute stays absolute
    const absolute = await run(["flow", "new", join(dir, "flows/a.excalidraw.md"), "bad"]);
    expect(absolute.stderr).toMatch(new RegExp(`^${join(dir, "screens.md")}:4: `));
  } finally {
    process.chdir(cwd);
  }
});

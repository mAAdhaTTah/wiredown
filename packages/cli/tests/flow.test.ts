import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { CommandError, fileOp } from "../src/output";
import { BASE, fixture, screensIn, VARIANT } from "./helpers";

test("new, add, styling idempotence and hand edits", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows/a.excalidraw.md");
  const first = await run([
    "flow",
    "new",
    file,
    "team",
    "team-after",
    "team",
    ...screensIn(dir),
    "--json",
  ]);
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
  const added = await run([
    "flow",
    "add-screen",
    file,
    "team-after",
    "--below",
    "F1",
    ...screensIn(dir),
    "--json",
  ]);
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
    ["add-screen", file, "missing", ...screensIn(dir)],
    ["add-screen", file, "team", "--below", "F99", ...screensIn(dir)],
  ]) {
    expect((await run(["flow", ...args])).exitCode).toBe(1);
  }
  expect(
    (await run(["flow", "add-screen", file, "team", "--below", "F1", "--right-of", "F2"])).exitCode,
  ).toBe(2);
});
test("--screens is required to add screens, and only then", async () => {
  const dir = await fixture({
    "screens.md": BASE,
    "bad.md": "# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad",
  });
  const file = join(dir, "flows/a.excalidraw.md");
  for (const args of [
    ["new", file, "team"],
    ["add-screen", file, "team"],
  ]) {
    const result = await run(["flow", ...args]);
    expect(result).toMatchObject({ exitCode: 2, stdout: "" });
    expect(result.stderr).toContain(
      `flow ${args[0]} needs --screens <screens.md> to embed screens from`,
    );
  }
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  const bad = await run(["flow", "new", file, "bad", "--screens", join(dir, "bad.md")]);
  expect(bad.exitCode).toBe(1);
  expect((await run(["flow", "new", file])).exitCode).toBe(0);
  expect((await run(["flow", "add-screen", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
});

test("empty frontmatter is filled without adding a second block", async () => {
  const { styleScreens } = await import("@wiredown/excalidraw");
  const source = "---\n---\n" + BASE;
  expect(styleScreens(source).match(/^---$/gm)).toHaveLength(2);
});

test.each([
  ["none", "", true],
  ["empty", "---\n---\n", true],
  ["unrelated", "---\ntags: [example]\n---\n", true],
  ["font", "---\nexcalidraw-font: Custom\n---\n", true],
  ["css", "---\nexcalidraw-css: custom\n---\n", true],
  ["both", "---\nexcalidraw-font: Custom\nexcalidraw-css: custom\n---\n", true],
  [
    "all",
    "---\nexcalidraw-font: Custom\nexcalidraw-css: custom\nexcalidraw-border-color: Red\n---\n",
    false,
  ],
  ["crlf", "---\r\ntags: [example]\r\n---\r\n", true],
])("frontmatter: %s", async (_name, prefix, changed) => {
  const { styleScreens } = await import("@wiredown/excalidraw");
  const nl = String(prefix).includes("\r\n") ? "\r\n" : "\n";
  const source = prefix + BASE.replace(/\n/g, nl);
  const styled = styleScreens(source);
  expect(styleScreens(styled)).toBe(styled);
  expect(styled.match(/^---\r?$/gm)).toHaveLength(2);
  expect(styled).toContain("excalidraw-font:");
  expect(styled).toContain("excalidraw-css:");
  expect(styled).toContain("excalidraw-border-color:");
  expect(styled.endsWith(BASE.replace(/\n/g, nl))).toBe(true);
  if (String(prefix).includes("tags:")) expect(styled).toContain("tags: [example]");
  if (String(prefix).includes("Custom")) expect(styled).toContain("excalidraw-font: Custom");
  if (nl === "\r\n") expect(styled.replace(/\r\n/g, "")).not.toContain("\n");
  const dir = await fixture({ "screens.md": source });
  const file = join(dir, "flows/a.excalidraw.md");
  const result = await run(["flow", "new", file, "team", ...screensIn(dir), "--json"]);
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
        ? ["new", target, "team", "teem", ...screensIn(dir)]
        : [
            "add-screen",
            target,
            kind === "bad-block" ? "bad" : kind === "unknown-screen" ? "teem" : "team",
            ...(kind === "unknown-frame" ? ["--right-of", "F99"] : []),
            ...screensIn(dir),
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

test.each([[], ["--right-of", "F1"], ["--below", "F1"], ["--title", "Custom"]])(
  "placement and human output %j",
  async (...flags: string[]) => {
    const dir = await fixture({ "screens.md": BASE });
    const file = join(dir, "flows/a.excalidraw.md");
    await run(["flow", "new", file, "team", ...screensIn(dir)]);
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
    const result = await run(["flow", "add-screen", file, "team", ...flags, ...screensIn(dir)]);
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
  const row = await run([
    "flow",
    "new",
    file,
    "team",
    "team-after",
    "team",
    ...screensIn(dir),
    "--json",
  ]);
  expect(row.exitCode).toBe(0);
  const frames = JSON.parse(row.stdout).frames;
  expect(frames).toHaveLength(3);
  const { checkScreens, layoutScreen } = await import("@wiredown/core");
  const { embedSize, flowFrames, screenElements } = await import("@wiredown/excalidraw");
  const images = flowFrames(parseFlow(await readFile(file, "utf8"))).map((f) => f.element);
  let x = 0;
  for (const [i, id] of ["team", "team-after", "team"].entries()) {
    const screen = checkScreens(BASE + "\n" + VARIANT).screens.find((s) => s.id === id)!;
    const rendered = screenElements(layoutScreen(screen.tree));
    const size = embedSize(rendered.width, rendered.height).image;
    expect(frames[i]).toEqual({
      frame: "F" + (i + 1),
      screen: id,
      title: screen.heading,
      id: images[i].id,
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
    ...screensIn(dir),
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
  const result = await run(["flow", "add-screen", file, "plain", ...screensIn(dir), "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).frames[0]).toMatchObject({ title: "plain", screen: "plain" });
  expect(parseFlow(await readFile(file, "utf8")).elements[0].text).toBe("F1 · plain");
});

const embedPaths = async (file: string) =>
  [...parseFlow(await readFile(file, "utf8")).embeds.values()].map((e) => e.path);

test.each(["git", "vault", "neither"])(
  "the embed is the screens file's path from the root: %s",
  async (kind) => {
    const dir = await fixture({});
    const flows = "a/b/flows";
    await mkdir(join(dir, flows), { recursive: true });
    await writeFile(join(dir, "a/b/screens.md"), BASE);
    await writeFile(join(dir, "a/ui.md"), BASE);
    // git wins over a vault nearer the flow
    if (kind === "git") await writeFile(join(dir, ".git"), "gitdir: elsewhere\n");
    if (kind === "git" || kind === "vault") await mkdir(join(dir, "a/.obsidian"));
    const from = kind === "git" ? "a/b/" : kind === "vault" ? "b/" : "";
    const file = join(dir, flows, "x.excalidraw.md");
    const screens = ["--screens", join(dir, "a/b/screens.md")];
    expect((await run(["flow", "new", file, "team", ...screens])).exitCode).toBe(0);
    expect(await embedPaths(file)).toEqual([`${from}screens`]);
    // --screens takes any .md file in the root, beside the flow or not
    const ui = await run(["flow", "add-screen", file, "team", "--screens", join(dir, "a/ui.md")]);
    if (kind === "neither") {
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
  const screens = ["--screens", join(repo, "spec/screens.md")];
  expect((await run(["flow", "new", file, "team", ...screens])).exitCode).toBe(0);
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
  const screens = ["--screens", join(repo, "spec/screens.md")];
  expect((await run(["flow", "add-screen", file, "team", ...screens])).exitCode).toBe(0);
  expect(await embedPaths(real)).toEqual(["spec/screens"]);
});

test("a screens file whose path would end the embed link early is refused", async () => {
  const dir = await fixture({});
  await writeFile(join(dir, ".git"), "");
  for (const name of ["a#b", "a|b", "a]b"]) {
    await mkdir(join(dir, name));
    await writeFile(join(dir, name, "screens.md"), BASE);
    const file = join(dir, name, "flows/x.excalidraw.md");
    const result = await run(["flow", "new", file, "team", ...screensIn(join(dir, name))]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${join(dir, name, "screens.md")}: a screens file's path cannot contain #, | or ], which end the path in an embed link`,
    );
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
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
    return found.ok ? [found.path.slice(dir.length + 1), found.embedPath] : found.message;
  };
  expect(await read("../screens")).toEqual(["a/screens.md", "a/screens"]);
  expect(await read("./ui.md")).toEqual(["a/flows/ui.md", "a/flows/ui"]);
  expect(await read("./screens")).toBe(`no ./screens.md was found from ${join(dir, "a/flows")}`);
  expect(await read("../../../outside")).toBe(`../../../outside points outside ${dir}`);
  // the path from the root wins over the files it is a suffix of
  expect(await read("screens")).toEqual(["screens.md", "screens"]);
  expect(await read("a/checkout/screens")).toEqual(["a/checkout/screens.md", "a/checkout/screens"]);
  // node_modules, dot folders and folders that cannot be read are not searched
  await mkdir(join(dir, "locked"), { mode: 0 });
  expect(await read("ui")).toEqual(["a/flows/ui.md", "a/flows/ui"]);
  expect(await read("a/screens")).toEqual(["a/screens.md", "a/screens"]);
  expect(await read("checkout/screens")).toBe(
    `checkout/screens matches several files: a/checkout/screens.md, b/checkout/screens.md; name one by its path from ${dir}`,
  );
  expect(await read("nope")).toBe(`no nope.md was found in ${dir}`);
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
    const outside = await run(["flow", "new", file, "team", ...screensIn(dir)]);
    expect(outside.exitCode).toBe(1);
    expect(outside.stderr).toContain(
      `the screens file ${join(dir, "screens.md")} points outside ${root}`,
    );
    // a symlink inside the root that leaves it is outside too
    await symlink(join(dir, "screens.md"), join(repo, "spec/screens.md"));
    const spec = screensIn(join(repo, "spec"));
    expect((await run(["flow", "new", file, "team", ...spec])).stderr).toContain(
      `points outside ${root}`,
    );
    await rm(join(repo, "spec/screens.md"));
    await writeFile(join(repo, "spec/screens.md"), BASE);
    expect((await run(["flow", "new", file, "team", ...spec])).exitCode).toBe(0);
    expect(await embedPaths(file)).toEqual([kind === "neither" ? "screens" : "spec/screens"]);
  },
);

test.each([
  ["add-screen", "team"],
  ["decision", "Choice"],
  ["connect", "F1", "F1"],
  ["note", "F1", "Note"],
  ["refresh"],
  ["render"],
  ["highlight", "F1", "#target"],
  ["mark", "F1", "#target", "Label"],
])("%s refuses newer live metadata before writing", async (...args) => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[0].customData = { wiredown: { v: 2 } };
  const source = serializeFlow(flow);
  await writeFile(file, source);
  const screens = await readFile(join(dir, "screens.md"), "utf8");
  const result = await run(
    args[0] === "render"
      ? ["render", file, "--out", join(dir, "out")]
      : [
          "flow",
          args[0],
          file,
          ...args.slice(1),
          ...(args[0] === "add-screen" ? screensIn(dir) : []),
        ],
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    `${file}: this drawing was written by a newer wiredown (data version 2); upgrade wiredown to ${args[0] === "render" ? "use" : "edit"} it`,
  );
  expect(await readFile(file, "utf8")).toBe(source);
  expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(screens);
});

test.each([2, "2"])("add-screen refuses unsupported version %s as JSON", async (v) => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[0].customData = { wiredown: { v } };
  await writeFile(file, serializeFlow(flow));
  const result = await run(["flow", "add-screen", file, "team", ...screensIn(dir), "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    flow: file,
    errors: [{ message: expect.stringContaining("data version") }],
  });
});

test("add-screen ignores deleted newer metadata", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements.push({
    ...flow.elements[0],
    id: "deleted1",
    isDeleted: true,
    customData: { wiredown: { v: 2 } },
  });
  await writeFile(file, serializeFlow(flow));
  expect((await run(["flow", "add-screen", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
});

test("paths print as given; a root found from a relative flow path prints relative", async () => {
  const dir = await realpath(
    await fixture({ "screens.md": "# Bad\n\n```wiredown\nnonsense: bad\n```\n^bad" }),
  );
  await mkdir(join(dir, "sub"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const bad = await run([
      "flow",
      "new",
      "flows/a.excalidraw.md",
      "bad",
      "--screens",
      "screens.md",
    ]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toMatch(/^screens\.md:4: \^bad: error: /);
    // the root of sub/flows/a.excalidraw.md is sub, which screens.md is outside
    const flow = "sub/flows/a.excalidraw.md";
    const outside = await run(["flow", "new", flow, "bad", "--screens", "screens.md"]);
    expect(outside.stderr).toContain("the screens file screens.md points outside sub\n");
    const absolute = await run(["flow", "new", join(dir, flow), "bad", "--screens", "screens.md"]);
    expect(absolute.stderr).toContain(`points outside ${join(dir, "sub")}\n`);
  } finally {
    process.chdir(cwd);
  }
});

test("a missing file is reported in plain words", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const flow = join(dir, "flows/a.excalidraw.md");
  const missing = await run(["flow", "add-screen", flow, "team", ...screensIn(dir)]);
  expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
  expect(missing.stderr).toBe(`${flow}: error: cannot read ${flow}: it does not exist\n`);
  const screens = join(dir, "nope.md");
  const result = await run(["flow", "new", flow, "team", "--screens", screens]);
  expect(result.stderr).toBe(
    `${flow}: error: cannot read the screens file ${screens}: it does not exist\n`,
  );
});

test("fileOp reports file system errors and passes others on", async () => {
  await expect(fileOp("cannot read x", readFile("/nonexistent/x"))).rejects.toThrow(
    new CommandError("cannot read x: it does not exist"),
  );
  const bug = new TypeError("bug");
  await expect(fileOp("cannot read x", Promise.reject(bug))).rejects.toBe(bug);
});

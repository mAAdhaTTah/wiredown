import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import type { ExcalidrawElementJson } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, screensIn } from "./helpers";

const TEAM = [
  "# Team members",
  "",
  "```wiredown",
  "window: Team settings",
  "  row:",
  "    h2: Members",
  "    text: 3 of 5 seats used #seats",
  "    button: *Invite member #invite",
  "  grid #members",
  "  [ ] | Name | Email | Role",
  "  [ ] | Anna Svensson | anna@example.com | Admin",
  "```",
  "^team",
  "",
].join("\n");
const ROW = "  [ ] | Erik Lund | erik@example.com | Member\n```";
const grow = (s: string) => s.replace("Admin\n```", "Admin\n" + ROW);

async function setup() {
  const dir = await fixture({ "screens.md": TEAM });
  const file = join(dir, "flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
  expect((await run(["flow", "highlight", file, "F1", "invite"])).exitCode).toBe(0);
  return { dir, file, screens: join(dir, "screens.md") };
}

test("refresh after the screen grows, then up to date", async () => {
  const { file, screens } = await setup();
  expect(await run(["flow", "refresh", file])).toEqual({
    exitCode: 0,
    stdout: "up to date\n",
    stderr: "",
  });
  const before = await readFile(file, "utf8");
  await writeFile(screens, grow(await readFile(screens, "utf8")));
  const stale = await run(["flow", "lint", file]);
  expect(stale.exitCode).toBe(1);
  expect(stale.stdout).toMatch(
    new RegExp(
      `^${file}: F1: error: stale embed size: (\\d+)x(\\d+), but \\^team now needs \\d+x\\d+\n${file}: 1 error\n$`,
    ),
  );
  const result = await run(["flow", "refresh", file, "--json"]);
  expect(result.exitCode).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out).toMatchObject({ flow: file, unresolved: [] });
  expect(out.changes).toHaveLength(1); // the highlight sits above the new row
  const [change] = out.changes;
  expect(change).toMatchObject({ frame: "F1", kind: "embed", x: expect.any(Number) });
  expect(change.width).toBe(change.image.to.width);
  expect(change.link.to.height).toBeGreaterThan(change.link.from.height);
  const after = await readFile(file, "utf8");
  expect(after).not.toBe(before);
  expect(after).toContain(`|${change.link.to.width}x${change.link.to.height}]]`);
  expect(await run(["flow", "lint", file])).toEqual({
    exitCode: 0,
    stdout: `${file}: 0 errors\n`,
    stderr: "",
  });
  expect((await run(["flow", "refresh", file])).stdout).toBe("up to date\n");
  expect(await readFile(file, "utf8")).toBe(after);
});

test("refresh moves overlays when a component moves, and reports lost ones", async () => {
  const { file, screens } = await setup();
  await run(["flow", "mark", file, "F1", "seats", "2"]);
  const source = await readFile(screens, "utf8");
  // a longer heading pushes #seats and #invite right; #seats then goes away
  await writeFile(screens, source.replace("h2: Members", "h2: Members of the team"));
  const moved = await run(["flow", "refresh", file]);
  expect(moved).toEqual({
    exitCode: 0,
    stdout: expect.stringMatching(/^F1 {2}embed \d+x\d+ -> \d+x\d+\n/),
    stderr: "",
  });
  expect(moved.stdout).toContain("F1  highlight #invite moved\nF1  mark 2 #seats moved\n");
  await writeFile(screens, source.replace(" #seats", ""));
  const lost = await run(["flow", "refresh", file, "--json"]);
  expect(lost.exitCode).toBe(0);
  expect(JSON.parse(lost.stdout).unresolved).toEqual([
    expect.objectContaining({
      kind: "mark",
      target: "seats",
      unresolved: "^team has no #seats any more",
    }),
  ]);
  const human = await run(["flow", "refresh", file]);
  expect(human.stdout).toContain("F1  mark 2 #seats unresolved: ^team has no #seats any more\n");
  const lint = await run(["flow", "lint", file, "--json"]);
  expect(lint.exitCode).toBe(1);
  expect(JSON.parse(lint.stdout)).toEqual({
    files: [
      {
        file,
        findings: [
          {
            frame: "F1",
            element: expect.any(String),
            message: expect.stringMatching(
              /^mark 2 #seats: \^team has no #seats any more; remove it with "wiredown flow remove <flow> \w{8}"$/,
            ),
          },
        ],
      },
    ],
  });
});

test("refresh with a missing or invalid screen still refreshes the others", async () => {
  const dir = await fixture({ "screens.md": TEAM + "\n" + BASE.replace("^team", "^base") });
  const file = join(dir, "flows/f.excalidraw.md");
  await run(["flow", "new", file, "team", "base", ...screensIn(dir)]);
  const screens = join(dir, "screens.md");
  const source = await readFile(screens, "utf8");
  await writeFile(screens, grow(source).replace("^base", "^renamed"));
  const result = await run(["flow", "refresh", file]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toMatch(/^F1 {2}embed /);
  expect(result.stderr).toBe(
    `${screens}: ^base: error: no screen "^base" (it has ^team, ^renamed)\n`,
  );
  const json = JSON.parse((await run(["flow", "refresh", file, "--json"])).stdout);
  expect(json).toEqual({
    flow: file,
    changes: [],
    unresolved: [],
    errors: [
      { file: screens, message: expect.stringContaining('no screen "^base"'), screen: "base" },
    ],
  });
  const lint = await run(["flow", "lint", file]);
  expect(lint.stdout).toBe(
    `${file}: F2: error: embeds [[screens#^base]], but ${screens} has no ^base\n${file}: 1 error\n`,
  );
  // no screens file at all
  const lone = await fixture({});
  await mkdir(join(lone, "flows"));
  const orphan = join(lone, "flows/o.excalidraw.md");
  await writeFile(orphan, await readFile(file, "utf8"));
  const missing = await run(["flow", "refresh", orphan]);
  expect(missing.exitCode).toBe(1);
  // nothing changed, but it is not up to date either
  expect(missing.stdout).toBe("");
  const why = `embeds [[screens#^team]], but no screens.md was found in ${lone}`;
  expect(missing.stderr).toContain(`${orphan}: F1: error: ${why}\n`);
  expect((await run(["flow", "lint", orphan])).stdout).toContain(`${orphan}: F1: error: ${why}\n`);
});

test("flow lint: several files, a dangling arrow, usage", async () => {
  const { dir, file } = await setup();
  const other = file.replace("f.excalidraw.md", "g.excalidraw.md");
  await run(["flow", "new", other, "team", "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(other, "utf8"));
  const f2 = flow.elements.find(
    (e) =>
      (e.customData as { wiredown?: { frame?: string; role?: string } })?.wiredown?.role ===
        "screen" && (e.customData as { wiredown: { frame: string } }).wiredown.frame === "F2",
  )!;
  f2.isDeleted = true;
  await writeFile(other, serializeFlow(flow));
  const result = await run(["flow", "lint", file, other]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe(
    `${file}: 0 errors\n` +
      `${other}: error: arrow F1 -> F2: its end is bound to image ${f2.id}, which is deleted\n` +
      `${other}: 1 error\n`,
  );
  expect((await run(["flow", "lint"])).exitCode).toBe(2);
  expect((await run(["flow", "refresh", file, other])).exitCode).toBe(2);
  expect((await run(["flow", "lint", file, "--title", "x"])).exitCode).toBe(2);
  expect((await run(["flow", "lint", join(file, "nope")])).exitCode).toBe(2);
});

test("lint reports compression and refresh rewrites an otherwise current drawing", async () => {
  const { default: LZString } = await import("lz-string");
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "a.excalidraw.md");
  expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
  const source = await readFile(file, "utf8");
  const compressed = source.replace(
    /```json\n([\s\S]*?)\n```/,
    (_match, body: string) => "```compressed-json\n" + LZString.compressToBase64(body) + "\n```",
  );
  await writeFile(file, compressed);
  const lint = await run(["flow", "lint", file]);
  expect(lint.exitCode).toBe(1);
  expect(lint.stdout).toContain("drawing is saved as compressed-json, so it does not diff;");
  const refreshed = await run(["flow", "refresh", file]);
  expect(refreshed.exitCode).toBe(0);
  expect(refreshed.stdout).toBe("rewrote compressed-json drawing as JSON\n");
  expect(await readFile(file, "utf8")).toBe(source);
  expect((await run(["flow", "lint", file])).exitCode).toBe(0);
});

test("lint follows each embed: the reproduced --screens case, vaults, two spec folders", async () => {
  const dir = await fixture({});
  for (const spec of ["spec-a", "spec-b"]) {
    await mkdir(join(dir, spec, "flows"), { recursive: true });
    // the same block id in both, with different components
    await writeFile(join(dir, spec, "screens.md"), spec === "spec-a" ? TEAM : BASE);
  }
  await writeFile(join(dir, "spec-a/ui.md"), BASE.replace("^team", "^members"));
  // flow new spec-a/flows/a.excalidraw.md members --screens spec-a/ui.md
  const a = join(dir, "spec-a/flows/a.excalidraw.md");
  const ui = ["--screens", join(dir, "spec-a/ui.md")];
  expect((await run(["flow", "new", a, "members", ...ui])).exitCode).toBe(0);
  expect((await run(["lint", join(dir, "spec-a")])).exitCode).toBe(0);
  // one flow, screens from two files
  expect(
    (await run(["flow", "add-screen", a, "team", ...screensIn(join(dir, "spec-a"))])).exitCode,
  ).toBe(0);
  expect((await run(["flow", "highlight", a, "F2", "members"])).exitCode).toBe(0);
  expect(await run(["flow", "lint", a])).toMatchObject({ exitCode: 0 });
  // each spec folder's flow resolves its own screens.md
  const b = join(dir, "spec-b/flows/b.excalidraw.md");
  expect((await run(["flow", "new", b, "team", ...screensIn(join(dir, "spec-b"))])).exitCode).toBe(
    0,
  );
  expect((await run(["flow", "highlight", b, "F1", "invite"])).exitCode).toBe(0);
  expect((await run(["lint", dir])).exitCode).toBe(0);
  await writeFile(join(dir, "spec-b/screens.md"), grow(TEAM));
  const stale = await run(["flow", "lint", a, b]);
  expect(stale.stdout).toContain(`${a}: 0 errors\n`);
  expect(stale.stdout).toContain(`${b}: F1: error: stale embed size`);
  // a vault above both spec folders is the root now: [[screens]] could be
  // either folder's file, and lint names both
  await writeFile(join(dir, "spec-b/screens.md"), BASE);
  await mkdir(join(dir, ".obsidian"));
  const ambiguous = await run(["flow", "lint", b]);
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.stdout).toContain(
    `${b}: F1: error: embeds [[screens#^team]], but screens matches several files: spec-a/screens.md, spec-b/screens.md; name one by its path from ${dir}\n`,
  );
  const v = join(dir, "spec-b/flows/v.excalidraw.md");
  expect((await run(["flow", "new", v, "team", ...screensIn(join(dir, "spec-b"))])).exitCode).toBe(
    0,
  );
  expect(await readFile(v, "utf8")).toContain("[[spec-b/screens#^team|");
  expect((await run(["flow", "lint", v])).exitCode).toBe(0);
});

test("an embed whose file is gone is reported for its frame; the rest still refresh", async () => {
  const dir = await fixture({ "screens.md": TEAM, "ui.md": TEAM });
  const file = join(dir, "flows/f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  await run(["flow", "add-screen", file, "team", "--screens", join(dir, "ui.md")]);
  await rm(join(dir, "ui.md"));
  await writeFile(join(dir, "screens.md"), grow(TEAM));
  const why = `embeds [[ui#^team]], but no ui.md was found in ${dir}`;
  const lint = await run(["flow", "lint", file]);
  expect(lint.stdout).toContain(`${file}: F1: error: stale embed size: `);
  expect(lint.stdout).toContain(`${file}: F2: error: ${why}\n${file}: 2 errors\n`);
  const refreshed = await run(["flow", "refresh", file]);
  expect(refreshed.exitCode).toBe(1);
  expect(refreshed.stdout).toMatch(/^F1 {2}embed /);
  expect(refreshed.stderr).toBe(`${file}: F2: error: ${why}\n`);
  expect(JSON.parse((await run(["flow", "refresh", file, "--json"])).stdout).errors).toEqual([
    { file, frame: "F2", message: why },
  ]);
});

test("refresh writes nothing when several files match a frame's embed", async () => {
  const dir = await fixture({});
  await writeFile(join(dir, ".git"), "");
  const one = BASE.replace("^team", "^one");
  for (const path of ["screens.md", "a/a/ui.md", "b/a/ui.md"]) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), one);
  }
  const file = join(dir, "flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "one", "one", ...screensIn(dir)])).exitCode).toBe(0);
  // F1 is stale and could be refreshed; F2's embed matches two files
  const flow = parseFlow(await readFile(file, "utf8"));
  const [[f1, e1], [f2, e2]] = [...flow.embeds];
  flow.embeds.set(f1, { ...e1, width: 1 });
  flow.embeds.set(f2, { ...e2, path: "a/ui" });
  await writeFile(file, serializeFlow(flow));
  const before = await readFile(file, "utf8");
  const result = await run(["flow", "refresh", file]);
  expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  expect(result.stderr).toBe(
    `${file}: F2: error: embeds [[a/ui#^one]], but a/ui matches several files: a/a/ui.md, b/a/ui.md; name one by its path from ${dir}\n`,
  );
  expect(await readFile(file, "utf8")).toBe(before);
});

test("refresh writes each link it rewrites with the path from the root", async () => {
  const dir = await fixture({});
  await writeFile(join(dir, ".git"), "");
  await mkdir(join(dir, "spec/flows"), { recursive: true });
  const base = BASE.replace("^team", "^base");
  await writeFile(join(dir, "spec/screens.md"), TEAM + "\n" + base);
  const file = join(dir, "spec/flows/f.excalidraw.md");
  expect(
    (await run(["flow", "new", file, "team", "base", ...screensIn(join(dir, "spec"))])).exitCode,
  ).toBe(0);
  // links in forms other than the one written: relative, and a trailing part
  const flow = parseFlow(await readFile(file, "utf8"));
  const paths = ["../screens", "screens"];
  for (const [fileId, embed] of flow.embeds)
    flow.embeds.set(fileId, { ...embed, path: paths.shift()! });
  await writeFile(file, serializeFlow(flow));
  expect((await run(["flow", "lint", file])).exitCode).toBe(0);
  // only ^team grows: F1's link is rewritten, F2's is left as it was
  await writeFile(join(dir, "spec/screens.md"), grow(TEAM) + "\n" + base);
  expect((await run(["flow", "refresh", file])).exitCode).toBe(0);
  const after = [...parseFlow(await readFile(file, "utf8")).embeds.values()];
  expect(after.map((e) => e.path)).toEqual(["spec/screens", "screens"]);
});

test.each(["vault", "git", "neither"])(
  "lint rejects an embed that leaves the flow's root: %s",
  async (kind) => {
    const dir = await fixture({ "outside.md": TEAM });
    const repo = join(dir, "repo");
    await mkdir(join(repo, "spec/flows"), { recursive: true });
    await writeFile(join(repo, "spec/screens.md"), TEAM);
    if (kind === "vault") await mkdir(join(repo, ".obsidian"));
    if (kind === "git") await mkdir(join(repo, ".git"));
    const root = kind === "neither" ? join(repo, "spec") : repo;
    const file = join(repo, "spec/flows/f.excalidraw.md");
    expect(
      (await run(["flow", "new", file, "team", "team", ...screensIn(join(repo, "spec"))])).exitCode,
    ).toBe(0);
    expect((await run(["lint", repo])).exitCode).toBe(0);
    const flow = parseFlow(await readFile(file, "utf8"));
    const [fileId, embed] = [...flow.embeds][1];
    const up = kind === "neither" ? "../../outside" : "../../../outside";
    flow.embeds.set(fileId, { ...embed, path: up });
    await writeFile(file, serializeFlow(flow));
    const why = `embeds [[${up}#^team]], but ${up} points outside ${root}`;
    const lint = await run(["flow", "lint", file]);
    expect(lint.stdout).toBe(`${file}: F2: error: ${why}\n${file}: 1 error\n`);
    const refresh = await run(["flow", "refresh", file]);
    expect(refresh).toMatchObject({ exitCode: 1, stderr: `${file}: F2: error: ${why}\n` });
    // a symlink inside the root that leaves it is outside too
    const link = kind === "vault" ? "spec/linked" : "linked";
    await symlink(
      join(dir, "outside.md"),
      kind === "vault" ? join(repo, "spec/linked.md") : join(root, "linked.md"),
    );
    flow.embeds.set(fileId, { ...embed, path: link });
    await writeFile(file, serializeFlow(flow));
    expect((await run(["flow", "lint", file])).stdout).toContain(
      `F2: error: embeds [[${link}#^team]], but ${link} points outside ${root}\n`,
    );
  },
);

test("refresh moves the arrow and the note after a screen grows", async () => {
  const dir = await fixture({ "screens.md": TEAM + "\n" + BASE.replace("^team", "^base") });
  const file = join(dir, "flows/f.excalidraw.md");
  const screens = join(dir, "screens.md");
  expect((await run(["flow", "new", file, "team", "base", ...screensIn(dir)])).exitCode).toBe(0);
  expect((await run(["flow", "note", file, "F1", "Shows the members"])).exitCode).toBe(0);
  expect((await run(["flow", "highlight", file, "F1", "invite"])).exitCode).toBe(0);
  const read = async () => parseFlow(await readFile(file, "utf8")).elements;
  const role = (elements: ExcalidrawElementJson[], r: string) =>
    elements.find((e) => (e.customData as { wiredown?: { role?: string } })?.wiredown?.role === r)!;
  const before = await read();
  const image = before.find((e) => e.type === "image")!;
  await writeFile(screens, grow(await readFile(screens, "utf8")));
  const result = await run(["flow", "refresh", file]);
  expect(result).toEqual({
    exitCode: 0,
    stdout: expect.stringMatching(
      /^F1 {2}embed \d+x\d+ -> \d+x\d+\nF1 {2}note \S+ moved\nF1 {2}arrow F1 -> F2 re-routed\n$/,
    ),
    stderr: "",
  });
  const after = await read();
  const grown = after.find((e) => e.id === image.id)!;
  const growth = Number(grown.height) - Number(image.height);
  expect(growth).toBeGreaterThan(0);
  expect(role(after, "note").y).toBe(Number(role(before, "note").y) + growth);
  const arrow = role(after, "arrow");
  expect(arrow.x).toBe(Number(grown.x) + Number(grown.width) + 6);
  expect(arrow.y).toBe(Number(grown.y) + Math.min(180, Number(grown.height) / 2));
  expect(await run(["flow", "lint", file])).toEqual({
    exitCode: 0,
    stdout: `${file}: 0 errors\n`,
    stderr: "",
  });
  const written = await readFile(file, "utf8");
  expect((await run(["flow", "refresh", file, "--json"])).stdout).toBe(
    JSON.stringify({ flow: file, changes: [], unresolved: [] }, null, 2) + "\n",
  );
  expect(await readFile(file, "utf8")).toBe(written);
});

test("lint reports an arrow and a note an older refresh left behind", async () => {
  const dir = await fixture({ "screens.md": TEAM + "\n" + BASE.replace("^team", "^base") });
  const file = join(dir, "flows/f.excalidraw.md");
  await run(["flow", "new", file, "team", "base", ...screensIn(dir)]);
  await run(["flow", "note", file, "F1", "Shows the members of the team"]);
  // the image and its link grow, as refresh used to leave them
  const flow = parseFlow(await readFile(file, "utf8"));
  const image = flow.elements.find((e) => e.type === "image")!;
  image.height = Number(image.height) + 100;
  const embed = flow.embeds.get(String(image.fileId))!;
  flow.embeds.set(String(image.fileId), { ...embed, height: embed.height! + 100 });
  await writeFile(file, serializeFlow(flow));
  const lint = await run(["flow", "lint", file]);
  expect(lint.stdout).not.toContain("px from its place");
  expect(lint.stdout).toContain(
    `${file}: F1: error: arrow F1 -> F2 no longer meets F1; run "wiredown flow refresh"\n`,
  );
});

test("flow lint reports unsupported metadata without refusing the file", async () => {
  const { file } = await setup();
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements.push({ ...flow.elements[0], id: "newer001", customData: { wiredown: { v: 2 } } });
  await writeFile(file, serializeFlow(flow));
  expect(await run(["flow", "lint", file])).toEqual({
    exitCode: 1,
    stdout: `${file}: error: this drawing was written by a newer wiredown (data version 2)\n${file}: 1 error\n`,
    stderr: "",
  });
});

/** Pastes F1's group as Excalidraw does: new ids, one new group, the data verbatim. */
async function pasteF1(file: string) {
  const flow = parseFlow(await readFile(file, "utf8"));
  const group = (flow.elements.find((e) => e.type === "image")!.groupIds as string[])[0];
  const parts = flow.elements.filter((e) => (e.groupIds as string[]).includes(group));
  parts.forEach((e, i) =>
    flow.elements.push({
      ...structuredClone(e),
      id: `pasted0${i}`,
      y: Number(e.y) + 2000,
      groupIds: ["pasted"],
    }),
  );
  await writeFile(file, serializeFlow(flow));
  return flow;
}

test("a pasted frame is a copy: lint names it once, refresh leaves it", async () => {
  const { file, screens } = await setup();
  const pasted = await pasteF1(file);
  const image = pasted.elements.find((e) => e.id.startsWith("pasted") && e.type === "image")!;
  expect((await run(["flow", "lint", file])).stdout).toBe(
    `${file}: F1: error: element ${image.id} is a copy of F1's frame; flow commands leave copies alone: delete it in the drawing\n${file}: 1 error\n`,
  );
  await writeFile(screens, grow(await readFile(screens, "utf8")));
  const result = await run(["flow", "refresh", file, "--json"]);
  expect(result.exitCode).toBe(0);
  const after = parseFlow(await readFile(file, "utf8"));
  expect(JSON.parse(result.stdout).changes.map((c: { element: string }) => c.element)).toEqual([
    after.elements.find((e) => e.type === "image")!.id,
  ]);
});

test("refresh refuses a name two elements claim and writes nothing", async () => {
  const { file, screens } = await setup();
  const flow = parseFlow(await readFile(file, "utf8"));
  // data from before elements recorded their own id
  for (const e of flow.elements) delete (e.customData as { wiredown: { id?: string } }).wiredown.id;
  await writeFile(file, serializeFlow(flow));
  await pasteF1(file);
  await writeFile(screens, grow(await readFile(screens, "utf8")));
  const before = await readFile(file, "utf8");
  const [f1, copy] = parseFlow(before).elements.filter((e) => e.type === "image");
  const message = `F1 is claimed by elements ${f1.id} and ${copy.id}; delete the copy`;
  expect((await run(["flow", "note", file, "F1", "Which?"])).stderr).toBe(
    `${file}: error: ${message}\n`,
  );
  expect(await run(["flow", "refresh", file])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `${file}: error: ${message}\n`,
  });
  const json = await run(["flow", "refresh", file, "--json"]);
  expect(json.exitCode).toBe(1);
  expect(JSON.parse(json.stdout)).toEqual({
    flow: file,
    changes: [],
    unresolved: [],
    errors: [{ message }],
  });
  expect(await readFile(file, "utf8")).toBe(before);
});

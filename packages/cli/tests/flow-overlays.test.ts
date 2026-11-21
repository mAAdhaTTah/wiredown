import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import { overlayBox, parseFlow, screenElements, serializeFlow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, VARIANT } from "./helpers";

test("overlays resolve variant ids and use a hand-moved image", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "team-after"])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[1].x = 777;
  flow.elements[1].y = -50;
  await writeFile(file, serializeFlow(flow));
  const rendered = screenElements(
    layoutScreen(checkScreens(BASE + "\n" + VARIANT).screens[1].tree),
  );
  const b = overlayBox(flow.elements[1], rendered, rendered.boxes.invite);
  const result = await run(["flow", "highlight", file, "F1", "#invite", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    flow: file,
    highlight: {
      id: expect.any(String),
      frame: "F1",
      screen: "team-after",
      target: "invite",
      x: b.x - 4,
      y: b.y - 4,
      width: b.width + 8,
      height: b.height + 8,
    },
  });
  const human = await run(["flow", "mark", file, "F1", "invite", "3"]);
  expect(human).toEqual({ exitCode: 0, stderr: "", stdout: "F1  mark 3  #invite\n" });
  const mark = await run(["flow", "mark", file, "F1", "#invite", "4", "--json"]);
  const value = JSON.parse(mark.stdout).mark;
  expect(mark.exitCode).toBe(0);
  expect(value).toMatchObject({ frame: "F1", screen: "team-after", target: "invite", label: "4" });
  const after = parseFlow(await readFile(file, "utf8"));
  const badge = after.elements.find((e) => e.id === value.id)!;
  expect(value.x).toBe(badge.x);
  expect(Number(badge.x) + Number(badge.width) / 2).toBe(b.x - Number(badge.width) / 3);
  expect(Number(badge.y) + Number(badge.height) / 2).toBe(b.y - Number(badge.height) / 3);
  expect(after.elements.slice(0, flow.elements.length)).toEqual(flow.elements);
  const hiHuman = await run(["flow", "highlight", file, "F1", "seats"]);
  expect(hiHuman.stdout).toBe("F1  highlight  #seats\n");
});

test.each(["frame", "decision", "screen", "invalid", "component", "highlight", "mark"])(
  "errors preserve bytes: %s",
  async (kind) => {
    const dir = await fixture({ "screens.md": BASE });
    const file = join(dir, "flows/f.excalidraw.md");
    await run(["flow", "new", file, "team"]);
    await run(["flow", "decision", file, "Proceed?"]);
    await run(["flow", "highlight", file, "F1", "invite"]);
    await run(["flow", "mark", file, "F1", "invite", "3"]);
    if (kind === "screen")
      await writeFile(join(dir, "screens.md"), BASE.replace("^team", "^other"));
    if (kind === "invalid")
      await writeFile(join(dir, "screens.md"), BASE.replace("window:", "nonsense:"));
    const before = await readFile(file, "utf8");
    const source = await readFile(join(dir, "screens.md"), "utf8");
    const args =
      kind === "mark"
        ? ["mark", file, "F1", "invite", "3"]
        : [
            "highlight",
            file,
            kind === "frame" ? "F99" : kind === "decision" ? "D1" : "F1",
            kind === "component" ? "invte" : "invite",
          ];
    const result = await run(["flow", ...args, "--json"]);
    expect(result.exitCode).toBe(1);
    const message = JSON.parse(result.stdout).errors[0].message;
    expect(message).toContain(
      {
        frame: "frames: F1",
        decision: "decision, not a frame",
        screen: "^other",
        invalid: "nonsense",
        component: 'did you mean "#invite"',
        highlight: "already highlights",
        mark: "already marks",
      }[kind],
    );
    const human = await run(["flow", ...args]);
    expect(human.exitCode).toBe(1);
    expect(human.stderr).toContain(message);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(join(dir, "screens.md"), "utf8")).toBe(source);
  },
);

test("replacement inherits its target id", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team-after"])).exitCode).toBe(0);
  expect(await run(["flow", "highlight", file, "F1", "seats"])).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "F1  highlight  #seats\n",
  });
});

test("removed targets list surviving ids and preserve bytes", async () => {
  const source =
    BASE + "\n" + VARIANT.replace("replace: seats\n  text: 2 of 5 seats used", "remove: invite");
  const dir = await fixture({ "screens.md": source });
  const file = join(dir, "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team-after"])).exitCode).toBe(0);
  const before = await readFile(file, "utf8");
  const result = await run(["flow", "highlight", file, "F1", "invite"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('no component "#invite" on ^team-after (ids: #seats)');
  expect(await readFile(file, "utf8")).toBe(before);
});

test("overlays follow the frame's embed; --screens is only for new and add-screen", async () => {
  const dir = await fixture({
    "custom.md": "```wiredown\nwindow: Home #home\n  button: Go #go\n```\n^home",
  });
  const file = join(dir, "f.excalidraw.md");
  const screens = join(dir, "custom.md");
  expect((await run(["flow", "new", file, "home", "--screens", screens])).exitCode).toBe(0);
  const result = await run(["flow", "highlight", file, "F1", "#home", "--json"]);
  expect(result.exitCode).toBe(0);
  // Export window (8,8) + host (10,0) - outline outset (4,4) = (14,4).
  expect(JSON.parse(result.stdout).highlight).toMatchObject({ x: 14, y: 4 });
  expect((await run(["flow", "mark", file, "F1", "go", "1"])).exitCode).toBe(0);
  const usage = await run(["flow", "mark", file, "F1", "go", "2", "--screens", screens]);
  expect(usage.exitCode).toBe(2);
  expect(usage.stderr).toContain("--screens requires new or add-screen");
});

test("each frame's overlays use the screens file its embed names", async () => {
  const dir = await fixture({
    "screens.md": BASE,
    "ui.md": "```wiredown\nwindow: Home #home\n  button: Go #team\n```\n^team",
  });
  const file = join(dir, "flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
  const ui = ["--screens", join(dir, "ui.md")];
  expect((await run(["flow", "add-screen", file, "team", ...ui])).exitCode).toBe(0);
  expect([...parseFlow(await readFile(file, "utf8")).embeds.values()].map((e) => e.path)).toEqual([
    "screens",
    "ui",
  ]);
  // the same block id in two files: F1 has #invite, F2 has #home
  expect((await run(["flow", "highlight", file, "F1", "invite"])).exitCode).toBe(0);
  expect((await run(["flow", "highlight", file, "F2", "home"])).exitCode).toBe(0);
  const wrong = await run(["flow", "highlight", file, "F2", "invite"]);
  expect(wrong.stderr).toContain('no component "#invite" on ^team (ids: #team, #home)');
  // a frame whose screens file is gone is reported; the other still works
  await rm(join(dir, "ui.md"));
  const gone = await run(["flow", "mark", file, "F2", "home", "1"]);
  expect(gone.exitCode).toBe(1);
  expect(gone.stderr).toBe(
    `${file}: error: F2 embeds [[ui#^team]], but no ui.md was found in ${dir}\n`,
  );
  // two files the link is a suffix of: refused, naming both, and nothing written
  for (const sub of ["a", "b"]) {
    await mkdir(join(dir, sub));
    await writeFile(join(dir, sub, "ui.md"), BASE);
  }
  const before = await readFile(file, "utf8");
  const ambiguous = await run(["flow", "mark", file, "F2", "home", "1"]);
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.stderr).toBe(
    `${file}: error: F2 embeds [[ui#^team]], but it matches several files: a/ui.md, b/ui.md; name one by its path from ${dir}\n`,
  );
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await run(["flow", "mark", file, "F1", "invite", "1"])).exitCode).toBe(0);
});

test.each(["", "   "])("empty mark label is usage error: %j", async (label) => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team"]);
  const before = await readFile(file, "utf8");
  expect((await run(["flow", "mark", file, "F1", "invite", label])).exitCode).toBe(2);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("an embed that points outside the flow's root is refused", async () => {
  const dir = await fixture({ "screens.md": BASE });
  await mkdir(join(dir, "spec/flows"), { recursive: true });
  await writeFile(join(dir, "spec/screens.md"), BASE);
  const file = join(dir, "spec/flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "team"])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  const [fileId, embed] = [...flow.embeds][0];
  flow.embeds.set(fileId, { ...embed, path: "../../screens" });
  await writeFile(file, serializeFlow(flow));
  const result = await run(["flow", "highlight", file, "F1", "invite"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    `${file}: error: F1 embeds [[../../screens#^team]], which points outside ${join(dir, "spec")}\n`,
  );
});

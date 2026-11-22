import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, screensIn, VARIANT } from "./helpers";

/** F1 (team) -> F2 (team-after) -> D1, a note, a highlight and a mark on F2. */
async function setup() {
  const dir = await fixture({ "screens.md": `${BASE}\n\n${VARIANT}\n` });
  const file = join(dir, "flows/f.excalidraw.md");
  for (const args of [
    ["new", file, "team", "team-after", ...screensIn(dir)],
    ["decision", file, "Done?"],
    ["connect", file, "F2", "D1", "Yes"],
    ["note", file, "F2", "Seats drop"],
    ["highlight", file, "F2", "#invite"],
    ["mark", file, "F2", "#seats", "2"],
  ])
    expect((await run(["flow", ...args])).exitCode).toBe(0);
  return { dir, file, screens: join(dir, "screens.md") };
}
const lint = (file: string) => run(["flow", "lint", file]);
const geometry = {
  x: expect.any(Number),
  y: expect.any(Number),
  width: expect.any(Number),
  height: expect.any(Number),
};

test("removes a frame with everything of ours on it, in one line", async () => {
  const { dir, file } = await setup();
  expect(await run(["flow", "remove", file, "F2"])).toEqual({
    exitCode: 0,
    stdout: "removed F2 (frame, 1 note, 2 overlays, 2 arrows)\n",
    stderr: "",
  });
  expect(await lint(file)).toMatchObject({ exitCode: 0, stdout: `${file}: 0 errors\n` });
  expect((await run(["flow", "add-screen", file, "team", ...screensIn(dir)])).stdout).toMatch(
    /^F3 /,
  );
});

test("each kind of target, as lines and as JSON", async () => {
  const { file } = await setup();
  const result = await run(["flow", "remove", file, "F2:note:1", "F2#seats:2", "F1->F2"]);
  expect(result.stdout).toMatch(
    /^removed note \w{8} on F2\nremoved mark F2 #seats 2\nremoved arrow F1 -> F2\n$/,
  );
  const json = await run(["flow", "remove", file, "F2#invite", "D1", "--json"]);
  expect(json.exitCode).toBe(0);
  const out = JSON.parse(json.stdout);
  expect(out).toEqual({
    flow: file,
    removed: [
      {
        kind: "highlight",
        element: expect.any(String),
        elements: [{ id: expect.any(String), type: "rectangle", ...geometry }],
        node: "F2",
        target: "invite",
      },
      {
        kind: "decision",
        element: expect.any(String),
        elements: expect.any(Array),
        node: "D1",
        notes: 0,
        overlays: 0,
        arrows: 1,
      },
    ],
    unbound: [],
  });
  // the diamond, the arrow, then their text
  expect(out.removed[1].elements).toEqual([
    { id: out.removed[1].element, type: "diamond", ...geometry },
    { id: expect.any(String), type: "arrow", ...geometry },
    { id: expect.any(String), type: "text", text: "Done?", ...geometry },
    { id: expect.any(String), type: "text", text: "Yes", ...geometry },
  ]);
  expect((await lint(file)).exitCode).toBe(0);
});

test("errors write nothing and follow the findings convention", async () => {
  const { file } = await setup();
  const before = await readFile(file, "utf8");
  expect(await run(["flow", "remove", file, "F2", "F9"])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `${file}: error: unknown node "F9" (nodes: F1, F2, D1)\n`,
  });
  const json = await run(["flow", "remove", file, "F2#nothing", "--json"]);
  expect(json.exitCode).toBe(1);
  expect(JSON.parse(json.stdout)).toEqual({
    flow: file,
    removed: [],
    unbound: [],
    errors: [{ message: "F2 has no highlight on #nothing (overlays: F2#invite, F2#seats:2)" }],
  });
  expect((await run(["flow", "remove", file])).exitCode).toBe(2);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("a person's arrow is unbound and kept; a person's element is refused", async () => {
  const { file } = await setup();
  const flow = parseFlow(await readFile(file, "utf8"));
  const f2 = flow.elements.find((e) => e.type === "image" && e.x !== 0)!;
  flow.elements.push({
    ...{ id: "handmade", type: "arrow", x: 0, y: 0, width: 5, height: 6, version: 1 },
    points: [[0, 0]],
    ...{ startBinding: null, endBinding: { elementId: f2.id, mode: "orbit", fixedPoint: [0, 0] } },
  });
  (f2.boundElements as unknown[]).push({ id: "handmade", type: "arrow" });
  await writeFile(file, serializeFlow(flow));
  const before = await readFile(file, "utf8");
  expect(await run(["flow", "remove", file, "handmade"])).toMatchObject({
    exitCode: 1,
    stderr: `${file}: error: element handmade has no wiredown data, so a person drew it; flow remove only removes what flow commands made\n`,
  });
  expect(await readFile(file, "utf8")).toBe(before);
  const result = await run(["flow", "remove", file, "F2"]);
  expect(result.stdout).toContain("unbound a hand-drawn arrow handmade from F2\n");
  await writeFile(file, before);
  const json = JSON.parse((await run(["flow", "remove", file, "F2", "--json"])).stdout);
  expect(json.unbound).toEqual([
    { element: "handmade", from: "F2", x: 0, y: 0, width: 5, height: 6 },
  ]);
  const arrow = parseFlow(await readFile(file, "utf8")).elements.find((e) => e.id === "handmade");
  expect(arrow).toMatchObject({ endBinding: null, version: 2 });
  expect(arrow!.isDeleted).toBeFalsy();
  expect((await lint(file)).exitCode).toBe(0);
});

test("lint, remove, lint: a highlight whose component left the screen", async () => {
  const { file, screens } = await setup();
  await writeFile(screens, (await readFile(screens, "utf8")).replace(" #invite", ""));
  const refreshed = JSON.parse((await run(["flow", "refresh", file, "--json"])).stdout);
  expect(refreshed.unresolved).toEqual([
    expect.objectContaining({ kind: "highlight", target: "invite" }),
  ]);
  expect((await lint(file)).stdout).toBe(
    `${file}: F2: error: highlight #invite: ^team-after has no #invite any more; remove it with "wiredown flow remove <flow> ${refreshed.unresolved[0].element}"\n` +
      `${file}: 1 error\n`,
  );
  expect((await run(["flow", "remove", file, "F2#invite"])).stdout).toBe(
    "removed highlight F2 #invite\n",
  );
  expect(await lint(file)).toMatchObject({ exitCode: 0, stdout: `${file}: 0 errors\n` });
});

/** Pastes F1's image and label as Excalidraw does: new ids, a new group, the data verbatim. */
async function pasteF1(file: string, { legacy = false } = {}) {
  const flow = parseFlow(await readFile(file, "utf8"));
  const f1 = flow.elements.filter((e) => e.text === "F1 · Team members" || e.x === 0);
  // data from before elements recorded their own id
  if (legacy)
    for (const e of flow.elements)
      delete (e.customData as { wiredown: { id?: string } }).wiredown.id;
  for (const e of f1)
    flow.elements.push({
      ...structuredClone(e),
      id: e.type === "image" ? "pasted01" : "pasted02",
      y: Number(e.y) + 1000,
      boundElements: null,
      groupIds: ["newgroup"],
    });
  await writeFile(file, serializeFlow(flow));
  return f1.find((e) => e.type === "image")!;
}

test("lint, remove, lint: a pasted copy of a frame", async () => {
  const { file } = await setup();
  await pasteF1(file);
  expect((await lint(file)).stdout).toBe(
    `${file}: F1: error: element pasted01 is a copy of F1's frame; flow commands leave copies alone: delete it in the drawing, or run "wiredown flow remove <flow> pasted01"\n${file}: 1 error\n`,
  );
  expect((await run(["flow", "remove", file, "pasted01"])).stdout).toBe(
    "removed pasted01, a copy of F1's frame, and 1 element pasted with it\n",
  );
  const after = parseFlow(await readFile(file, "utf8")).elements.filter((e) => e.isDeleted);
  expect(after.map((e) => e.id).sort()).toEqual(["pasted01", "pasted02"]);
  expect(await lint(file)).toMatchObject({ exitCode: 0, stdout: `${file}: 0 errors\n` });
});

test("lint, remove, lint: a copy pasted before elements recorded their id", async () => {
  const { file } = await setup();
  const image = await pasteF1(file, { legacy: true });
  const claimed = `F1 is claimed by elements ${image.id} and pasted01; remove the copy with "wiredown flow remove <flow> ${image.id}" or "wiredown flow remove <flow> pasted01"`;
  expect((await lint(file)).stdout).toBe(`${file}: F1: error: ${claimed}\n${file}: 1 error\n`);
  expect((await run(["flow", "remove", file, "F1"])).stderr).toBe(`${file}: error: ${claimed}\n`);
  expect((await run(["flow", "remove", file, "pasted01"])).stdout).toBe(
    "removed pasted01, one of the elements claiming F1 (frame)\n",
  );
  const after = parseFlow(await readFile(file, "utf8")).elements.filter((e) => e.isDeleted);
  expect(after.map((e) => e.id).sort()).toEqual(["pasted01", "pasted02"]);
  expect(await lint(file)).toMatchObject({ exitCode: 0, stdout: `${file}: 0 errors\n` });
});

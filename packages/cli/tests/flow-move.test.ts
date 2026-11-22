import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flowNodes, parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, screensIn } from "./helpers";

/**
 * F1 -> F2 -> D1 in a row, a note, a highlight and a mark on F2; in F2's
 * group a person's rectangle and a person's copy of the note, and a
 * person's arrow from F1 to F2.
 */
async function setup() {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "flows/f.excalidraw.md");
  for (const args of [
    ["new", file, "team", "team", ...screensIn(dir)],
    ["decision", file, "Done?"],
    ["connect", file, "F2", "D1", "Yes"],
    ["note", file, "F2", "Seats drop"],
    ["highlight", file, "F2", "#invite"],
    ["mark", file, "F2", "#seats", "2"],
  ])
    expect((await run(["flow", ...args])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  const [f1, f2] = ["F1", "F2"].map((n) => flowNodes(flow).find((o) => o.node === n)!.element);
  const group = (f2.groupIds as string[])[0];
  const note = flow.elements.find((e) => e.text === "Seats drop")!;
  flow.elements.push(
    {
      id: "rect0001",
      type: "rectangle",
      x: Number(f2.x) + 5,
      y: 5,
      width: 10,
      height: 10,
      groupIds: [group],
    },
    { ...structuredClone(note), id: "copy0001", y: Number(note.y) + 30, text: "Mine" },
    {
      ...{ id: "hand0001", type: "arrow", x: 0, y: 0, version: 1 },
      points: [
        [0, 0],
        [10, 0],
      ],
      startBinding: { elementId: f1.id, mode: "orbit", fixedPoint: [0, 0] },
      endBinding: { elementId: f2.id, mode: "orbit", fixedPoint: [1, 1] },
    },
  );
  for (const e of [f1, f2]) (e.boundElements as unknown[]).push({ id: "hand0001", type: "arrow" });
  await writeFile(file, serializeFlow(flow));
  return { file };
}
const lint = (file: string) => run(["flow", "lint", file]);
const theirs = async (file: string) =>
  parseFlow(await readFile(file, "utf8")).elements.filter((e) =>
    /^(rect|copy|hand)0001$/.test(e.id),
  );

test("each placement moves the node with everything of ours on it, in one line", async () => {
  const { file } = await setup();
  const person = await theirs(file);
  // the person's copy of the note is the only finding, before and after
  const copyOnly = (await lint(file)).stdout;
  expect(copyOnly).toContain(`${file}: 1 error\n`);
  expect(await run(["flow", "move", file, "F2", "--below", "F1"])).toEqual({
    exitCode: 0,
    stdout: "moved F2 to 0,503 (frame, 1 note, 2 overlays, 2 arrows)\n",
    stderr: "",
  });
  expect((await lint(file)).stdout).toBe(copyOnly);
  const right = await run(["flow", "move", file, "D1", "--right-of", "F1"]);
  expect(right.stdout).toBe("moved D1 to 696,-3.5 (decision, 1 arrow)\n");
  expect((await lint(file)).stdout).toBe(copyOnly);
  // --to=<x>,<y> takes a negative x
  const to = await run(["flow", "move", file, "F2", "--to=-1000,1500"]);
  expect(to.stdout).toBe("moved F2 to -1000,1500 (frame, 1 note, 2 overlays, 2 arrows)\n");
  expect((await lint(file)).stdout).toBe(copyOnly);
  // a person's rectangle and copy in F2's group, and their arrow, never move
  expect(await theirs(file)).toEqual(person);
});

test("JSON is shaped like the other flow commands'", async () => {
  const { file } = await setup();
  const f2 = flowNodes(parseFlow(await readFile(file, "utf8"))).find((n) => n.node === "F2")!;
  const result = await run(["flow", "move", file, "F2", "--to", "0,1000", "--json"]);
  expect(result.exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  const out = JSON.parse(result.stdout);
  const { width, height } = f2.element;
  expect(out).toEqual({
    flow: file,
    moved: {
      node: "F2",
      kind: "frame",
      element: f2.element.id,
      x: 0,
      y: 1000,
      width,
      height,
      elements: expect.any(Array),
      notes: 1,
      overlays: 2,
      arrows: 2,
    },
    changes: [expect.any(Object), expect.any(Object)],
    unresolved: [],
  });
  // the image, label, note, highlight, mark and the mark's text moved
  expect(out.moved.elements).toHaveLength(6);
  expect(out.moved.elements[0]).toBe(f2.element.id);
  // each re-routed arrow as refresh reports it, with its geometry in the file
  for (const c of out.changes) {
    const a = flow.elements.find((e) => e.id === c.element)!;
    expect(c).toMatchObject({ kind: "arrow", x: a.x, y: a.y, width: a.width, height: a.height });
  }
  const failed = await run(["flow", "move", file, "F2", "--to", "0,0", "--json"]);
  expect(failed.exitCode).toBe(1);
  expect(JSON.parse(failed.stdout)).toEqual({
    flow: file,
    moved: null,
    changes: [],
    unresolved: [],
    errors: [{ message: "F2 at 0,0 would overlap F1; pick another place" }],
  });
});

test("refusals write nothing and follow the findings convention", async () => {
  const { file } = await setup();
  const before = await readFile(file, "utf8");
  expect(await run(["flow", "move", file, "F9", "--below", "F1"])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `${file}: error: unknown node "F9" (nodes: F1, F2, D1)\n`,
  });
  expect(await run(["flow", "move", file, "F2", "--right-of", "F9"])).toMatchObject({
    exitCode: 1,
    stderr: `${file}: error: unknown node "F9" (nodes: F1, F2, D1)\n`,
  });
  expect(await run(["flow", "move", file, "F2", "--to", "100,100"])).toMatchObject({
    exitCode: 1,
    stderr: `${file}: error: F2 at 100,100 would overlap F1; pick another place\n`,
  });
  for (const args of [["F2"], ["F2", "--to", "1,2", "--below", "F1"], ["F2", "--to", "here"]])
    expect((await run(["flow", "move", file, ...args])).exitCode).toBe(2);
  expect((await run(["flow", "note", file, "F2", "x", "--to", "1,2"])).stderr).toContain(
    "--to requires move",
  );
  expect(await readFile(file, "utf8")).toBe(before);
  // a name two nodes claim: the whole flow is refused, as refresh refuses it
  const flow = parseFlow(before);
  const f2 = flowNodes(flow).find((n) => n.node === "F2")!.element;
  const claim = structuredClone(f2);
  claim.id = "claim001";
  claim.y = 3000;
  delete (claim.customData as { wiredown: { id?: string } }).wiredown.id;
  delete (f2.customData as { wiredown: { id?: string } }).wiredown.id;
  flow.elements.push(claim);
  const claimed = serializeFlow(flow);
  await writeFile(file, claimed);
  const refused = await run(["flow", "move", file, "F1", "--to", "0,-2000"]);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(`F2 is claimed by elements ${f2.id} and claim001`);
  expect(await readFile(file, "utf8")).toBe(claimed);
});

test("an overlap lint reports is fixed by the move it suggests", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", "team", ...screensIn(dir)])).exitCode).toBe(0);
  expect((await run(["flow", "note", file, "F2", "Seats"])).exitCode).toBe(0);
  // a person drags F2's group onto F1
  const flow = parseFlow(await readFile(file, "utf8"));
  const f2 = flowNodes(flow).find((n) => n.node === "F2")!.element;
  const group = (f2.groupIds as string[])[0];
  const dx = 50 - Number(f2.x);
  for (const e of flow.elements.filter((e) => (e.groupIds as string[]).includes(group)))
    e.x = Number(e.x) + dx;
  await writeFile(file, serializeFlow(flow));
  const found = await lint(file);
  expect(found.stdout).toContain(
    `${file}: F2: error: overlaps F1; move one of them in the drawing, or with "wiredown flow move", e.g. "wiredown flow move <flow> F2 --below F1"\n`,
  );
  // back where it was, so its arrow already meets it
  expect((await run(["flow", "move", file, "F2", "--right-of", "F1"])).stdout).toBe(
    "moved F2 to 696,0 (frame, 1 note)\n",
  );
  expect(await lint(file)).toEqual({ exitCode: 0, stdout: `${file}: 0 errors\n`, stderr: "" });
});

test("moving to the current coordinates or placement writes nothing", async () => {
  const { file } = await setup();
  const before = await readFile(file, "utf8");
  const modified = (await stat(file)).mtimeMs;
  expect(await run(["flow", "move", file, "F1", "--to", "0,0"])).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "F1 is already at 0,0\n",
  });
  const f2 = flowNodes(parseFlow(before)).find((n) => n.node === "F2")!.element;
  const result = await run(["flow", "move", file, "F2", "--right-of", "F1", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    flow: file,
    moved: {
      unchanged: true,
      node: "F2",
      kind: "frame",
      element: f2.id,
      x: f2.x,
      y: f2.y,
      width: f2.width,
      height: f2.height,
      elements: [],
      notes: 0,
      overlays: 0,
      arrows: 0,
    },
    changes: [],
    unresolved: [],
  });
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await stat(file)).mtimeMs).toBe(modified);
});

test("a node may not land on another node's note, and lint reports one dragged there", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  expect(
    (await run(["flow", "new", file, "team", "team", "team", ...screensIn(dir)])).exitCode,
  ).toBe(0);
  expect((await run(["flow", "note", file, "F1", "Note under F1"])).exitCode).toBe(0);
  const flow = parseFlow(await readFile(file, "utf8"));
  const note = flow.elements.find((e) => e.text === "Note under F1")!;
  const before = await readFile(file, "utf8");
  const y = Number(note.y) + 5;
  expect(await run(["flow", "move", file, "F3", "--to", `0,${y}`])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `${file}: error: F3 at 0,${y} would overlap F1; pick another place\n`,
  });
  expect(await readFile(file, "utf8")).toBe(before);
  // a person drags F3 there in the drawing
  const f3 = flowNodes(flow).find((n) => n.node === "F3")!.element;
  const dx = -Number(f3.x);
  const dy = y - Number(f3.y);
  for (const e of flow.elements.filter(
    (e) => (e.groupIds as string[])[0] === (f3.groupIds as string[])[0],
  ))
    Object.assign(e, { x: Number(e.x) + dx, y: Number(e.y) + dy });
  await writeFile(file, serializeFlow(flow));
  expect((await lint(file)).stdout).toContain(
    `${file}: F3: error: overlaps F1's note ${note.id}; move one of them in the drawing, or with "wiredown flow move", e.g. "wiredown flow move <flow> F3 --below F1"\n`,
  );
});

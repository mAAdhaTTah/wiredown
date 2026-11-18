import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flowNodes, parseFlow, serializeFlow } from "@wiredown/excalidraw";
import type { Flow } from "@wiredown/excalidraw";
import { expect, test } from "vitest";
import { run } from "../src/index.js";
import { BASE, fixture, VARIANT } from "./helpers.js";

const read = async (file: string) => parseFlow(await readFile(file, "utf8"));
const arrows = (flow: Flow) => flow.elements.filter((e) => e.type === "arrow");
const node = (flow: Flow, name: string) => flowNodes(flow).find((n) => n.node === name)!.element;

async function twoScreens() {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows/f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", "team-after"])).exitCode).toBe(0);
  return { dir, file };
}

test("new connects its screens in a row; one screen gets no arrow", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows/row.excalidraw.md");
  const result = await run(["flow", "new", file, "team", "team-after", "team", "--json"]);
  expect(result.exitCode).toBe(0);
  const flow = await read(file);
  const ids = arrows(flow).map((a) => a.id);
  expect(JSON.parse(result.stdout).arrows).toEqual([
    { id: ids[0], from: "F1", to: "F2", label: null },
    { id: ids[1], from: "F2", to: "F3", label: null },
  ]);
  expect(node(flow, "F2").boundElements).toEqual(ids.map((id) => ({ id, type: "arrow" })));
  const human = await run(["flow", "new", join(dir, "flows/h.excalidraw.md"), "team", "team"]);
  expect(human.stdout).toMatch(/^F1 {2}team {2}\d+x\d+\nF2 {2}team {2}\d+x\d+\nF1 -> F2\n$/);
  const single = join(dir, "flows/one.excalidraw.md");
  const one = await run(["flow", "new", single, "team", "--json"]);
  expect(JSON.parse(one.stdout).arrows).toEqual([]);
  expect((await read(single)).elements.map((e) => e.type)).toEqual(["text", "image"]);
});

test("decision, connect and note: output and the written drawing", async () => {
  const { file } = await twoScreens();
  const decision = await run([
    "flow",
    "decision",
    file,
    "Confirmed?",
    "--right-of",
    "F2",
    "--json",
  ]);
  expect(decision.exitCode).toBe(0);
  let flow = await read(file);
  const d1 = node(flow, "D1");
  expect(JSON.parse(decision.stdout)).toEqual({
    flow: file,
    decision: { node: "D1", x: d1.x, y: d1.y, width: 260, height: 170 },
  });
  expect(d1.x).toBe(Number(node(flow, "F2").x) + Number(node(flow, "F2").width) + 340);

  const connected = await run(["flow", "connect", file, "F2", "D1", "Submit", "--json"]);
  expect(connected.exitCode).toBe(0);
  flow = await read(file);
  const arrow = arrows(flow).at(-1)!;
  expect(JSON.parse(connected.stdout)).toEqual({
    flow: file,
    arrow: { id: arrow.id, from: "F2", to: "D1", label: "Submit" },
  });
  expect(arrow.endBinding).toMatchObject({ elementId: d1.id });
  expect(flow.elements.at(-1)).toMatchObject({ text: "Submit", containerId: arrow.id });

  const noted = await run(["flow", "note", file, "F1", "Unspecified: empty state", "--json"]);
  expect(noted.exitCode).toBe(0);
  flow = await read(file);
  const note = flow.elements.at(-1)!;
  expect(JSON.parse(noted.stdout)).toEqual({ flow: file, note: { id: note.id, node: "F1" } });
  expect(note).toMatchObject({
    x: node(flow, "F1").x,
    y: Number(node(flow, "F1").y) + Number(node(flow, "F1").height) + 20,
    customData: { wiredown: { role: "note", node: "F1" } },
  });

  // human output: one line per change
  expect((await run(["flow", "decision", file, "Again?", "--below", "D1"])).stdout).toBe(
    "D2  260x170\n",
  );
  expect((await run(["flow", "connect", file, "D1", "F1", "no"])).stdout).toBe('D1 -> F1  "no"\n');
  expect((await run(["flow", "connect", file, "D1", "D2"])).stdout).toBe("D1 -> D2\n");
  const human = await run(["flow", "note", file, "D1", "Why?"]);
  expect(human.stdout).toBe(`D1  note ${(await read(file)).elements.at(-1)!.id}\n`);
  expect(arrows(await read(file))).toHaveLength(4);
  // every element a command made names itself in its data
  for (const e of (await read(file)).elements)
    expect(e.customData).toMatchObject({ wiredown: { id: e.id } });
});

test("a pasted copy of a frame is left alone; an old unnamed one is refused", async () => {
  const { file } = await twoScreens();
  const flow = await read(file);
  const f1 = node(flow, "F1");
  // Excalidraw pastes with new ids and a new group, and the data verbatim
  flow.elements.push({ ...structuredClone(f1), id: "pasted01", y: 1000, groupIds: ["pasted"] });
  await writeFile(file, serializeFlow(flow));
  expect((await run(["flow", "note", file, "F1", "On the original"])).exitCode).toBe(0);
  const note = (await read(file)).elements.at(-1)!;
  expect(note.customData).toMatchObject({ wiredown: { anchor: f1.id } });
  expect(Number(note.y)).toBeLessThan(1000);

  // data from before elements named themselves: two claimants, so a refusal
  const old = await read(file);
  for (const e of old.elements) delete (e.customData as { wiredown: { id?: string } }).wiredown.id;
  await writeFile(file, serializeFlow(old));
  const before = await readFile(file, "utf8");
  expect((await run(["flow", "note", file, "F1", "Which?"])).stderr).toBe(
    `${file}: error: F1 is claimed by elements ${f1.id} and pasted01; delete the copy\n`,
  );
  expect(await readFile(file, "utf8")).toBe(before);
});

test("no screens file is needed", async () => {
  const dir = await fixture({});
  const file = join(dir, "f.excalidraw.md");
  expect((await run(["flow", "new", file])).exitCode).toBe(0);
  for (const args of [
    ["decision", file, "First?"],
    ["decision", file, "Second?"],
    ["connect", file, "D1", "D2", "yes"],
    ["note", file, "D2", "A note"],
  ])
    expect((await run(["flow", ...args])).exitCode).toBe(0);
  expect((await read(file)).elements).toHaveLength(7);
});

test.each([
  ["connect unknown", ["connect", "F1", "F9"], 'unknown node "F9" (nodes: F1, F2)'],
  ["connect itself", ["connect", "F1", "F1", "loop"], 'cannot connect "F1" to itself'],
  ["note unknown", ["note", "D1", "text"], 'unknown node "D1" (nodes: F1, F2)'],
  ["decision unknown", ["decision", "Ok?", "--below", "F3"], 'unknown node "F3" (nodes: F1, F2)'],
])("failure writes nothing: %s", async (_name, [command, ...args], message) => {
  const { file } = await twoScreens();
  const before = await readFile(file, "utf8");
  const human = await run(["flow", command, file, ...args]);
  expect(human).toEqual({ exitCode: 1, stdout: "", stderr: `${file}: error: ${message}\n` });
  const result = await run(["flow", command, file, ...args, "--json"]);
  expect(result.exitCode).toBe(1);
  const key = command === "connect" ? "arrow" : command;
  expect(JSON.parse(result.stdout)).toEqual({ flow: file, [key]: null, errors: [{ message }] });
  expect(await readFile(file, "utf8")).toBe(before);
});

test("a missing drawing is an error and is not created", async () => {
  const dir = await fixture({});
  const file = join(dir, "missing.excalidraw.md");
  const result = await run(["flow", "decision", file, "Ok?"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(file);
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test.each([
  [["connect", "F1"]],
  [["connect", "F1", "F2", "label", "extra"]],
  [["note", "F1"]],
  [["note", "F1", " "]],
  [["decision"]],
  [["decision", "a", "b"]],
  [["connect", "F1", "F2", "--right-of", "F1"]],
  [["note", "F1", "x", "--below", "F1"]],
  [["decision", "x", "--title", "T"]],
  [["decision", "x", "--screens", "s.md"]],
  [["decision", "x", "--right-of", "F1", "--below", "F1"]],
  [["frobnicate"]],
])("usage error %j exits 2 and writes nothing", async ([command, ...args]) => {
  const { file } = await twoScreens();
  const before = await readFile(file, "utf8");
  const result = await run(["flow", command, file, ...args]);
  expect(result.exitCode).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/^wiredown: /);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("a hand edit between commands is used and kept", async () => {
  const { file } = await twoScreens();
  const flow = await read(file);
  const f1 = node(flow, "F1"),
    f2 = node(flow, "F2");
  // a person moves F2 under F1 and adds their own text
  Object.assign(f2, { x: f1.x, y: Number(f1.y) + Number(f1.height) + 400 });
  flow.elements.push({ ...flow.elements[0], id: "human123", text: "Mine", rawText: "Mine" });
  await writeFile(file, serializeFlow(flow));
  const result = await run(["flow", "connect", file, "F1", "F2", "--json"]);
  expect(result.exitCode).toBe(0);
  const after = await read(file);
  const arrow = after.elements.find((e) => e.id === JSON.parse(result.stdout).arrow.id)!;
  const cx = Number(f1.x) + Number(f1.width) / 2;
  // bottom of F1 to top of F2, down the middle, offset from new's F1 -> F2
  expect(arrow).toMatchObject({
    x: cx + 70,
    y: Number(f1.y) + Number(f1.height) + 6,
    points: [
      [0, 0],
      [0, 400 - 12],
    ],
  });
  // Only bindings and Excalidraw revision metadata change on bound nodes.
  const without = (e: Record<string, unknown>) => ({
    ...e,
    boundElements: null,
    version: null,
    versionNonce: null,
    updated: null,
  });
  expect(after.elements.slice(0, flow.elements.length).map(without)).toEqual(
    flow.elements.map(without),
  );
  expect(after.elements.find((e) => e.id === "human123")).toEqual(
    flow.elements.find((e) => e.id === "human123"),
  );
  for (const name of ["F1", "F2"]) {
    const before = node(flow, name);
    const next = node(after, name);
    expect(next.version).toBe(Number(before.version) + 1);
    expect(next.versionNonce).not.toBe(before.versionNonce);
    expect(Number(next.updated)).toBeGreaterThanOrEqual(Number(before.updated));
  }
  expect(node(after, "F2")).toMatchObject({ x: f2.x, y: f2.y });
  expect(node(after, "F2").boundElements).toEqual([
    ...(f2.boundElements as unknown[]),
    { id: arrow.id, type: "arrow" },
  ]);
});

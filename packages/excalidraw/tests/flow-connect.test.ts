import { readFileSync } from "node:fs";
import { EXCALIFONT, fontMeasurer } from "@wiredown/core";
import { expect, test } from "vitest";
import {
  addDecision,
  addNote,
  addScreen,
  connect,
  flowFrames,
  flowNodes,
  newFlow,
  parseFlow,
  serializeFlow,
} from "../src/index";
import type { ExcalidrawElementJson, Flow } from "../src/index";
import { bindingFailures, pluginFailures } from "./plugin-checks";

const small = {
  screenId: "home",
  title: "Home",
  path: "screens",
  size: { width: 100, height: 200 },
};
const tall = { ...small, size: { width: 400, height: 500 } }; // image 420x505
const measure = (text: string) =>
  fontMeasurer(EXCALIFONT).measure(text, { fontSize: 16, fontFamily: 5 });

/** Plugin and binding checks pass, and the written file reads back to itself. */
function valid(flow: Flow) {
  const out = serializeFlow(flow);
  expect(pluginFailures(out)).toEqual([]);
  expect(bindingFailures(out)).toEqual([]);
  expect(serializeFlow(parseFlow(out))).toBe(out);
  return out;
}
const byId = (flow: Flow, id: string) => flow.elements.find((e) => e.id === id)!;
const node = (flow: Flow, name: string) => flowNodes(flow).find((n) => n.node === name)!.element;
function move(flow: Flow, name: string, x: number, y: number) {
  Object.assign(node(flow, name), { x, y });
}
const points = (a: ExcalidrawElementJson) => {
  const [dx, dy] = (a.points as number[][])[1];
  return [Number(a.x), Number(a.y), Number(a.x) + dx, Number(a.y) + dy];
};

test("decisions: numbering, diamond, centred text and placement", () => {
  const flow = newFlow();
  addScreen(flow, small);
  expect(addDecision(flow, { text: "Confirmed?" })).toBe("D1");
  const d1 = node(flow, "D1");
  // right of F1, centred on F1's arrow port (half its 205px height)
  expect(d1).toMatchObject({
    type: "diamond",
    x: 120 + 340,
    y: 102.5 - 85,
    width: 260,
    height: 170,
    backgroundColor: "#fff3bf",
    roundness: { type: 2 },
    customData: { wiredown: { node: "D1", role: "decision", id: d1.id } },
  });
  const text = flow.elements.at(-1)!;
  expect(d1.boundElements).toEqual([{ type: "text", id: text.id }]);
  const size = measure("Confirmed?");
  expect(text).toMatchObject({
    type: "text",
    text: "Confirmed?",
    containerId: d1.id,
    textAlign: "center",
    verticalAlign: "middle",
    x: 460 + (260 - size.w) / 2,
    y: 17.5 + (170 - size.h) / 2,
    customData: { wiredown: { node: "D1", role: "label", id: text.id } },
  });
  expect(addDecision(flow, { text: "Below?", place: { below: "D1" } })).toBe("D2");
  expect(node(flow, "D2")).toMatchObject({ x: 460, y: 17.5 + 170 + 340 });
  // a frame right of a decision lines its port up with the diamond's centre
  addScreen(flow, { ...small, place: { rightOf: "D1" } });
  expect(flowFrames(flow)[1].element).toMatchObject({ x: 460 + 260 + 340, y: 0 });
  // default: right of the rightmost node
  addDecision(flow, { text: "Again?" });
  expect(node(flow, "D3")).toMatchObject({ x: 1060 + 120 + 340, y: 17.5 });
  valid(flow);
  // deleting D2 and D3 with their text keeps their numbers taken
  for (const e of flow.elements.slice(4, 6).concat(flow.elements.slice(-2))) e.isDeleted = true;
  expect(addDecision(flow, { text: "Next" })).toBe("D4");
  expect(flowNodes(flow).map((n) => n.node)).toEqual(["F1", "D1", "F2", "D4"]);
  expect(() => addDecision(flow, { text: "x", place: { rightOf: "D2" } })).toThrow(
    'unknown node "D2" (nodes: F1, D1, F2, D4)',
  );
  valid(flow);
});

test("decision text wraps inside the diamond, which grows for long text", () => {
  const flow = newFlow();
  addDecision(flow, { text: "Later steps on those boards?" });
  expect(flow.elements[1].text).toBe("Later steps on\nthose boards?");
  addDecision(flow, { text: Array(30).fill("word").join(" ") });
  const [diamond, text] = flow.elements.slice(2);
  expect(Number(diamond.height)).toBe(Math.ceil(2 * Number(text.height)));
  expect(Number(diamond.height)).toBeGreaterThan(170);
  valid(flow);
});

test.each([
  ["right", 1000, 50, [426, 180, 994, 230], [1, 180 / 505], [0, 180 / 505]],
  ["left", -1000, 50, [-6, 180, -574, 230], [0, 180 / 505], [1, 180 / 505]],
  ["below", 100, 900, [210, 511, 310, 894], [0.5, 1], [0.5, 0]],
  ["above", 0, -1000, [210, -6, 210, -489], [0.5, 0], [0.5, 1]],
])("arrow to a frame moved %s", (_name, x, y, ends, start, end) => {
  const flow = newFlow();
  addScreen(flow, tall);
  addScreen(flow, tall);
  move(flow, "F2", x, y);
  const id = connect(flow, "F1", "F2");
  const arrow = byId(flow, id);
  expect(points(arrow)).toEqual(ends);
  expect(arrow).toMatchObject({
    type: "arrow",
    width: Math.abs(ends[2] - ends[0]),
    height: Math.abs(ends[3] - ends[1]),
    roundness: { type: 2 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
    lastCommittedPoint: null,
    boundElements: null,
    startBinding: { elementId: node(flow, "F1").id, mode: "orbit", fixedPoint: start },
    endBinding: { elementId: node(flow, "F2").id, mode: "orbit", fixedPoint: end },
    customData: { wiredown: { role: "arrow", from: "F1", to: "F2", id } },
  });
  expect((arrow.points as number[][])[0]).toEqual([0, 0]);
  for (const name of ["F1", "F2"])
    expect(node(flow, name).boundElements).toEqual([{ id, type: "arrow" }]);
  valid(flow);
});

test("a labelled arrow has its label as bound text", () => {
  const flow = newFlow();
  addScreen(flow, tall);
  addScreen(flow, tall);
  const id = connect(flow, "F1", "F2", { label: "Submit the form and wait for it" });
  const arrow = byId(flow, id);
  const label = flow.elements.at(-1)!;
  expect(arrow.boundElements).toEqual([{ type: "text", id: label.id }]);
  expect(label).toMatchObject({
    type: "text",
    containerId: id,
    text: "Submit the form and wait\nfor it",
    textAlign: "center",
    verticalAlign: "middle",
    fontSize: 16,
    customData: { wiredown: { role: "label", from: "F1", to: "F2", id: label.id } },
  });
  const [sx, sy, ex, ey] = points(arrow);
  expect(Number(label.x) + Number(label.width) / 2).toBeCloseTo((sx + ex) / 2);
  expect(Number(label.y) + Number(label.height) / 2).toBeCloseTo((sy + ey) / 2);
  const out = valid(flow);
  expect(out).toContain(`## Text Elements\n`);
  expect(out).toContain(`Submit the form and wait\nfor it ^${label.id}\n`);
});

test("further arrows between the same pair are offset, in either direction", () => {
  const flow = newFlow();
  addScreen(flow, tall);
  addScreen(flow, tall);
  const ids = [
    connect(flow, "F1", "F2"),
    connect(flow, "F1", "F2"),
    connect(flow, "F2", "F1", { label: "back" }),
  ];
  const ys = ids.map((id) => byId(flow, id).y);
  expect(ys).toEqual([180, 250, 110]);
  const slots = ids.map((id) => byId(flow, id).customData as { wiredown: { slot?: number } });
  expect(slots.map((d) => d.wiredown.slot)).toEqual([undefined, 1, 2]);
  expect(new Set(ids.map((id) => JSON.stringify(points(byId(flow, id))))).size).toBe(3);
  expect(node(flow, "F1").boundElements).toEqual(ids.map((id) => ({ id, type: "arrow" })));
  valid(flow);
});

test("connecting frames and decisions meets the diamond's sides", () => {
  const flow = newFlow();
  addScreen(flow, small);
  addDecision(flow, { text: "Ok?" });
  const d = node(flow, "D1");
  const first = byId(flow, connect(flow, "F1", "D1", { label: "Submit" }));
  // straight: F1's port and D1's centre line up; ends 6px off the left tip
  expect(points(first)).toEqual([126, 102.5, 454, 102.5]);
  expect((first.endBinding as { fixedPoint: number[] }).fixedPoint).toEqual([0, 0.5]);
  const second = byId(flow, connect(flow, "D1", "F1"));
  // 70px down, the diamond's left side is this far left of its centre
  const half = 130 * (1 - 70 / 85);
  expect(points(second)).toEqual([590 - half - 6, 172.5, 126, 172.5]);
  addScreen(flow, { ...small, place: { below: "D1" } });
  const down = byId(flow, connect(flow, "D1", "F2", { label: "no" }));
  expect(points(down)).toEqual([590, 17.5 + 170 + 6, 590, 17.5 + 170 + 340 - 6]);
  expect(d.boundElements).toEqual([
    { type: "text", id: flow.elements[3].id },
    { id: first.id, type: "arrow" },
    { id: second.id, type: "arrow" },
    { id: down.id, type: "arrow" },
  ]);
  valid(flow);
});

test("connect errors leave the drawing unchanged", () => {
  const flow = newFlow();
  addScreen(flow, small);
  addDecision(flow, { text: "Ok?" });
  const before = structuredClone(flow.elements);
  expect(() => connect(flow, "F1", "F1")).toThrow('cannot connect "F1" to itself');
  expect(() => connect(flow, "F1", "F9")).toThrow('unknown node "F9" (nodes: F1, D1)');
  expect(() => connect(flow, "D9", "F1")).toThrow('unknown node "D9" (nodes: F1, D1)');
  expect(() => addNote(flow, "X1", "hi")).toThrow('unknown node "X1" (nodes: F1, D1)');
  expect(flow.elements).toEqual(before);
});

test("notes stack under a frame or decision, wrapped to its width", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const first = byId(flow, addNote(flow, "F1", "Unspecified: empty state"));
  expect(first).toMatchObject({
    type: "text",
    x: 0,
    y: 205 + 20,
    fontSize: 16,
    strokeColor: "#495057",
    containerId: null,
    boundElements: null,
    customData: { wiredown: { role: "note", node: "F1", id: first.id } },
  });
  const lines = String(first.text).split("\n");
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) expect(measure(line).w).toBeLessThanOrEqual(120);
  expect(first.width).toBe(measure(String(first.text)).w);
  // a person moves the first note down; the next goes under it
  first.y = 245;
  const second = byId(flow, addNote(flow, "F1", "Second"));
  expect(second).toMatchObject({ x: 0, y: 245 + Number(first.height) + 20, text: "Second" });
  addDecision(flow, { text: "Ok?" });
  const third = byId(flow, addNote(flow, "D1", "Why"));
  // beside the diamond, below the height its rightward arrow leaves at
  expect(third).toMatchObject({ x: 460 + 260 + 20, y: 17.5 + 85 + 20 });
  valid(flow);
});

test("the prototype's fixture gains elements and keeps everything else", () => {
  const source = readFileSync(
    new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url),
    "utf8",
  );
  const flow = parseFlow(source);
  expect(bindingFailures(source)).toEqual([]);
  const old = structuredClone(flow.elements);
  expect(flowNodes(flow)).toEqual([]);
  expect(addDecision(flow, { text: "Done?" })).toBe("D1");
  valid(flow);
  expect(addScreen(flow, { ...small, place: { rightOf: "D1" } })).toBe("F4");
  valid(flow);
  connect(flow, "D1", "F4", { label: "yes" });
  valid(flow);
  addNote(flow, "F4", "a note");
  const out = valid(flow);
  const after = parseFlow(out);
  expect(after.elements.slice(0, old.length)).toEqual(old);
  expect(after.elements.length).toBe(old.length + 7);
  expect(after.source.head).toEqual(flow.source.head);
  expect(out.slice(0, out.indexOf("## Text Elements"))).toBe(
    source.slice(0, source.indexOf("## Text Elements")),
  );
});

test("a note records its node's element and joins the node's group", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const image = node(flow, "F1");
  const group = (image.groupIds as string[])[0];
  const before = structuredClone(image);
  const note = byId(flow, addNote(flow, "F1", "A"));
  expect(note.customData).toEqual({
    wiredown: { v: 1, role: "note", node: "F1", anchor: image.id, id: note.id },
  });
  expect(note.groupIds).toEqual([group]);
  expect(image).toEqual(before); // a frame's group exists already
  // a decision gets its group on its first note: the diamond and its text join
  addDecision(flow, { text: "Ok?" });
  const diamond = node(flow, "D1");
  const text = flow.elements.find((e) => e.containerId === diamond.id)!;
  // a person grouped the decision before its first note: ours goes innermost
  diamond.groupIds = ["person1"];
  text.groupIds = ["person1"];
  const why = byId(flow, addNote(flow, "D1", "Why"));
  const made = (why.groupIds as string[])[0];
  expect(made).not.toBe(group);
  expect(why.groupIds).toEqual([made, "person1"]);
  expect(diamond).toMatchObject({ groupIds: [made, "person1"], version: 2 });
  expect(text).toMatchObject({ groupIds: [made, "person1"], version: 2 });
  expect(byId(flow, addNote(flow, "D1", "Again")).groupIds).toEqual([made, "person1"]);
  expect(diamond.groupIds).toEqual([made, "person1"]);
  valid(flow);
});

test("a note on a frame inside a person's groups stays inside them", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const image = node(flow, "F1");
  const group = (image.groupIds as string[])[0];
  image.groupIds = [group, "human", "outer"];
  flow.elements[0].groupIds = [group, "human", "outer"];
  const before = structuredClone(flow.elements);
  const note = byId(flow, addNote(flow, "F1", "A"));
  expect(note.groupIds).toEqual([group, "human", "outer"]);
  expect(flow.elements.slice(0, before.length)).toEqual(before);
});

test("a node name claimed twice is refused, naming both elements", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const image = node(flow, "F1");
  // data written before elements recorded their own id
  delete (image.customData as { wiredown: { id?: string } }).wiredown.id;
  flow.elements.push({ ...structuredClone(image), id: "copy0001" });
  const before = structuredClone(flow.elements);
  expect(() => addNote(flow, "F1", "hi")).toThrow(
    `F1 is claimed by elements ${image.id} and copy0001; remove the copy with "wiredown flow remove <flow> ${image.id}" or "wiredown flow remove <flow> copy0001"`,
  );
  expect(flow.elements).toEqual(before);
});

test("a person's pasted copy of a node is not a node", () => {
  const flow = newFlow();
  addScreen(flow, small);
  addDecision(flow, { text: "Ok?" });
  const image = node(flow, "F1");
  const diamond = node(flow, "D1");
  // Excalidraw pastes with new ids and a new group, and the data verbatim
  for (const [e, id] of [
    [image, "pasted01"],
    [diamond, "pasted02"],
  ] as const)
    flow.elements.push({ ...structuredClone(e), id, x: 5000, groupIds: ["pasted"] });
  expect(flowNodes(flow).map((n) => n.element.id)).toEqual([image.id, diamond.id]);
  const note = byId(flow, addNote(flow, "F1", "hi"));
  expect(note.customData).toMatchObject({ wiredown: { anchor: image.id, id: note.id } });
  expect(byId(flow, connect(flow, "F1", "D1")).startBinding).toMatchObject({
    elementId: image.id,
  });
  // placement and numbering: right of the rightmost node, the copies' names taken
  expect(addDecision(flow, { text: "Next?" })).toBe("D2");
  expect(Number(node(flow, "D2").x)).toBeLessThan(5000);
  valid(flow);
});

test("parallel labels move to one third from their own start", () => {
  const flow = newFlow();
  addScreen(flow, tall);
  addScreen(flow, tall);
  const first = connect(flow, "F1", "F2", { label: "Invite member" });
  const label = flow.elements.find((e) => e.containerId === first)!;
  const version = Number(label.version);
  const second = connect(flow, "F2", "F1", { label: "Sent" });
  expect(Number(label.version)).toBe(version + 1);
  const other = flow.elements.find((e) => e.containerId === second)!;
  expect(Number(label.x) + Number(label.width)).toBeLessThan(Number(other.x));
  // a person's copy of the first arrow and its label is left where it is
  const copy: ExcalidrawElementJson = { ...structuredClone(byId(flow, first)), id: "copyarrw" };
  const copied = { ...structuredClone(label), id: "copylabl", containerId: copy.id, x: 2100 };
  copy.boundElements = [{ type: "text", id: copied.id }];
  flow.elements.push(copy, copied);
  const before = structuredClone(copied);
  const third = connect(flow, "F1", "F2", { label: "Again" });
  expect(copied).toEqual(before);
  flow.elements.splice(flow.elements.indexOf(copy), 2);
  for (const id of [first, second, third]) {
    const a = byId(flow, id);
    const t = flow.elements.find((e) => e.containerId === id)!;
    const [sx, sy, ex, ey] = points(a);
    expect(Number(t.x) + Number(t.width) / 2).toBeCloseTo(sx + (ex - sx) / 3);
    expect(Number(t.y) + Number(t.height) / 2).toBeCloseTo(sy + (ey - sy) / 3);
  }
  valid(flow);
});

test("decision notes stack beside the diamond clear of its downward arrow", () => {
  const flow = newFlow();
  addDecision(flow, { text: "Ok?" });
  addScreen(flow, { ...small, place: { below: "D1" } });
  const arrow = byId(flow, connect(flow, "D1", "F1"));
  const a = byId(flow, addNote(flow, "D1", "First"));
  const b = byId(flow, addNote(flow, "D1", "Second"));
  expect(Number(a.x)).toBeGreaterThan(Number(arrow.x));
  expect(b.x).toBe(a.x);
  expect(b.y).toBe(Number(a.y) + Number(a.height) + 20);
  valid(flow);
});

test("a new arrow takes the slot a deleted one freed, not a taken one", () => {
  const flow = newFlow();
  addScreen(flow, {
    screenId: "a",
    title: "A",
    path: "screens",
    size: { width: 300, height: 400 },
  });
  addScreen(flow, {
    screenId: "b",
    title: "B",
    path: "screens",
    size: { width: 300, height: 400 },
  });
  const ids = [0, 1, 2].map(() => connect(flow, "F1", "F2"));
  byId(flow, ids[1]).isDeleted = true;
  const again = byId(flow, connect(flow, "F1", "F2"));
  const live = [ids[0], ids[2], again.id].map((id) => byId(flow, id));
  expect(new Set(live.map((e) => e.y)).size).toBe(3);
  expect(again.y).toBe(byId(flow, ids[1]).y);
});

test("new notes ignore a note dragged out of the stack", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const first = byId(flow, addNote(flow, "F1", "First"));
  first.y = Number(first.y) + 260;
  const next = byId(flow, addNote(flow, "F1", "Next"));
  const image = node(flow, "F1");
  expect(next.y).toBe(Number(image.y) + Number(image.height) + 20);
});

test("notes stack by position after their drawing order is swapped", () => {
  const flow = newFlow();
  addScreen(flow, small);
  const a = byId(flow, addNote(flow, "F1", "A"));
  const b = byId(flow, addNote(flow, "F1", "B"));
  [a.y, b.y] = [b.y, a.y];
  const c = byId(flow, addNote(flow, "F1", "C"));
  expect(c.y).toBe(305);
});

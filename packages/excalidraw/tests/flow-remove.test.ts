import { expect, test } from "vitest";
import { identity } from "../src/flow-edit.js";
import {
  addDecision,
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  flowNodes,
  lintFlow,
  newFlow,
  parseFlow,
  removeFromFlow,
  serializeFlow,
} from "../src/index.js";
import type { ExcalidrawElementJson, Flow, ScreenState } from "../src/index.js";
import { bindingFailures, pluginFailures } from "./plugin-checks.js";

const box = { x: 20, y: 30, w: 40, h: 50 };
const home: ScreenState = { width: 100, height: 200, boxes: { invite: box, seats: box } };
const screens = () => home;

/**
 * F1 -> D1 -> F2, F2 -> F1 twice, notes on D1 and F2, a highlight and a mark
 * on F2, a person's rectangle and a person's arrow from F2 to F1.
 */
function build() {
  const flow = newFlow();
  for (const id of ["a", "b"])
    addScreen(flow, { screenId: id, title: id, path: "screens", size: home });
  addDecision(flow, { text: "Ok?", place: { below: "F1" } });
  connect(flow, "F1", "D1", { label: "Go" });
  connect(flow, "D1", "F2");
  connect(flow, "F2", "F1", { label: "Back" });
  connect(flow, "F2", "F1");
  addNote(flow, "D1", "Why");
  addNote(flow, "F2", "Second");
  const overlay = { target: "invite", box, screen: home };
  addHighlight(flow, "F2", overlay);
  addMark(flow, "F2", { ...overlay, label: "3" });
  // drawn first under F2, then moved below the second: notes count top to bottom
  const first = addNote(flow, "F2", "First");
  const second = flow.elements.find((e) => e.text === "Second")!;
  [byId(flow, first).y, second.y] = [second.y, Number(second.y) + 100];
  const [f1, f2] = ["F1", "F2"].map((n) => node(flow, n));
  flow.elements.push(
    { id: "rect0001", type: "rectangle", x: -500, y: 0, width: 10, height: 10, version: 1 },
    {
      ...{ id: "hand0001", type: "arrow", x: 0, y: 0, version: 1 },
      startBinding: { elementId: f2.id, mode: "orbit", fixedPoint: [0, 0] },
      endBinding: { elementId: f1.id, mode: "orbit", fixedPoint: [1, 1] },
    },
  );
  for (const n of [f1, f2]) (n.boundElements as unknown[]).push({ id: "hand0001", type: "arrow" });
  // as read back from a file
  return parseFlow(serializeFlow(flow));
}
const byId = (flow: Flow, id: string) => flow.elements.find((e) => e.id === id)!;
const node = (flow: Flow, name: string) => flowNodes(flow).find((n) => n.node === name)!.element;
const role = (flow: Flow, r: string, extra: (e: ExcalidrawElementJson) => boolean = () => true) =>
  flow.elements.filter((e) => identity(e)?.role === r && extra(e));
const deleted = (flow: Flow) => flow.elements.filter((e) => e.isDeleted).map((e) => e.id);

/** Lint-clean, plugin-clean, and written as it reads. */
function sound(flow: Flow) {
  expect(lintFlow(flow, screens)).toEqual([]);
  const text = serializeFlow(flow);
  expect(pluginFailures(text)).toEqual([]);
  expect(bindingFailures(text)).toEqual([]);
  expect(serializeFlow(parseFlow(text))).toBe(text);
}
/** Every element but `changed` (and the removed ones) is byte-identical to `before`. */
function untouchedExcept(flow: Flow, before: ExcalidrawElementJson[], changed: string[]) {
  const gone = new Set(deleted(flow));
  for (const e of before) {
    const now = byId(flow, e.id);
    if (gone.has(e.id))
      expect(now).toMatchObject({ isDeleted: true, version: Number(e.version) + 1 });
    else if (changed.includes(e.id)) expect(now.version).toBe(Number(e.version) + 1);
    else expect(now).toEqual(e);
  }
}

test("a frame takes its label, notes, overlays and arrows; a person's arrow is unbound", () => {
  const flow = build();
  sound(flow);
  const before = structuredClone(flow.elements);
  const [f1, f2, d1] = ["F1", "F2", "D1"].map((n) => node(flow, n));
  const { removed, unbound } = removeFromFlow(flow, ["F2"]);
  expect(removed).toEqual([
    expect.objectContaining({
      kind: "frame",
      element: f2.id,
      node: "F2",
      notes: 2,
      overlays: 2,
      arrows: 3,
    }),
  ]);
  expect(unbound).toEqual([{ element: "hand0001", from: "F2" }]);
  const label = role(flow, "label", (e) => e.text === "F2 · b")[0];
  const parts = flow.elements.filter((e) => {
    const d = identity(e);
    return d?.anchor === f2.id || (d?.role === "arrow" && [d.from, d.to].includes("F2"));
  });
  const texts = flow.elements.filter((e) => e.text === "Back");
  expect(deleted(flow).sort()).toEqual(
    [...new Set([f2, label, ...parts, ...texts].map((e) => e.id))].sort(),
  );
  untouchedExcept(flow, before, [f1.id, d1.id, "hand0001"]);
  expect(byId(flow, "hand0001")).toMatchObject({
    startBinding: null,
    endBinding: { elementId: f1.id },
  });
  // what is left lists only what is left
  expect(f1.boundElements).toEqual([
    { id: role(flow, "arrow")[0].id, type: "arrow" },
    { id: "hand0001", type: "arrow" },
  ]);
  expect(d1.boundElements).toHaveLength(2); // its text and F1's arrow
  sound(flow);
  // numbers are never reused
  addScreen(flow, { screenId: "c", title: "c", path: "screens", size: home });
  expect(flowNodes(flow).map((n) => n.node)).toEqual(["F1", "D1", "F3"]);
});

test("a decision takes its text, notes and arrows; its number is not reused", () => {
  const flow = build();
  const before = structuredClone(flow.elements);
  const { removed } = removeFromFlow(flow, ["D1"]);
  expect(removed).toEqual([
    expect.objectContaining({ kind: "decision", node: "D1", notes: 1, overlays: 0, arrows: 2 }),
  ]);
  expect(flow.elements.filter((e) => e.isDeleted).map((e) => e.text ?? e.type)).toEqual([
    "diamond",
    "Ok?",
    "arrow",
    "Go",
    "arrow",
    "Why",
  ]);
  untouchedExcept(flow, before, [node(flow, "F1").id, node(flow, "F2").id]);
  sound(flow);
  expect(addDecision(flow, { text: "Again?" })).toBe("D2");
});

test("an arrow target removes every arrow of ours that way, with labels", () => {
  const flow = build();
  const before = structuredClone(flow.elements);
  const back = role(flow, "arrow", (e) => identity(e)?.from === "F2");
  const { removed, unbound } = removeFromFlow(flow, ["F2->F1"]);
  expect(removed).toEqual([
    {
      kind: "arrow",
      element: back[0].id,
      elements: [back[0].id, back[1].id, flow.elements.find((e) => e.text === "Back")!.id],
      from: "F2",
      to: "F1",
      arrows: 2,
    },
  ]);
  expect(unbound).toEqual([]);
  // the person's arrow from F2 to F1 stays, bound
  untouchedExcept(flow, before, [node(flow, "F1").id, node(flow, "F2").id]);
  sound(flow);
  expect(() => removeFromFlow(flow, ["F2->F1"])).toThrow(
    "no arrow F2->F1 (arrows: F1->D1, D1->F2)",
  );
});

test("overlays: F2#id is the highlight, F2#id:label the mark", () => {
  const flow = build();
  const before = structuredClone(flow.elements);
  const [hi] = role(flow, "highlight");
  const [mark] = role(flow, "mark");
  const text = flow.elements.find((e) => e.containerId === mark.id)!;
  expect(removeFromFlow(flow, ["F2#invite"]).removed).toEqual([
    { kind: "highlight", element: hi.id, elements: [hi.id], node: "F2", target: "invite" },
  ]);
  expect(() => removeFromFlow(flow, ["F2#invite"])).toThrow(
    "F2 has no highlight on #invite (overlays: F2#invite:3)",
  );
  expect(() => removeFromFlow(flow, ["F2#invite:4"])).toThrow(
    "F2 has no mark 4 on #invite (overlays: F2#invite:3)",
  );
  expect(() => removeFromFlow(flow, ["D1#invite"])).toThrow("D1 is a decision, not a frame");
  expect(removeFromFlow(flow, ["F2#invite:3"]).removed).toEqual([
    {
      kind: "mark",
      element: mark.id,
      elements: [mark.id, text.id],
      node: "F2",
      target: "invite",
      label: "3",
    },
  ]);
  untouchedExcept(flow, before, []);
  sound(flow);
});

test("notes: F2:note is all of them, F2:note:2 the second from the top", () => {
  const flow = build();
  const first = flow.elements.find((e) => e.text === "First")!;
  const second = flow.elements.find((e) => e.text === "Second")!;
  expect(removeFromFlow(flow, ["F2:note:2"]).removed).toEqual([
    { kind: "note", element: second.id, elements: [second.id], node: "F2", notes: 1 },
  ]);
  expect(() => removeFromFlow(flow, ["F2:note:2"])).toThrow(
    "F2 has 1 note; F2:note:2 is not one of F2:note:1 to :1",
  );
  expect(removeFromFlow(flow, ["F2:note"]).removed[0].elements).toEqual([first.id]);
  expect(() => removeFromFlow(flow, ["F2:note"])).toThrow("F2 has no notes");
  expect(() => removeFromFlow(flow, ["F9:note"])).toThrow('unknown node "F9" (nodes: F1, F2, D1)');
  sound(flow);
});

test("element ids: ours with what is bound to them; never a person's", () => {
  const flow = build();
  const before = serializeFlow(flow);
  expect(() => removeFromFlow(flow, ["rect0001"])).toThrow(
    "element rect0001 has no wiredown data, so a person drew it; flow remove only removes what flow commands made",
  );
  expect(() => removeFromFlow(flow, ["hand0001"])).toThrow("so a person drew it");
  expect(() => removeFromFlow(flow, ["nothing1"])).toThrow(
    'no element "nothing1"; name a node (F2, D1), an arrow (F1->F2)',
  );
  expect(serializeFlow(flow)).toBe(before);
  const go = flow.elements.find((e) => e.text === "Go")!;
  const [arrow] = role(flow, "arrow");
  const [mark] = role(flow, "mark");
  const { removed } = removeFromFlow(flow, [arrow.id, mark.id, node(flow, "F1").id]);
  expect(removed.map((r) => [r.kind, r.elements.length])).toEqual([
    ["arrow", 2],
    ["mark", 2],
    ["frame", 7], // image, label, the arrow above and its label again, both Back arrows and a label
  ]);
  expect(deleted(flow)).toContain(go.id);
  sound(flow);
});

test("several targets are all or nothing", () => {
  const flow = build();
  const before = serializeFlow(flow);
  expect(() => removeFromFlow(flow, ["F2", "F9"])).toThrow('unknown node "F9"');
  expect(() => removeFromFlow(flow, ["F2#invite", "F2#nothing"])).toThrow("F2 has no highlight");
  expect(serializeFlow(flow)).toBe(before);
  // overlapping targets remove each element once
  const elements = structuredClone(flow.elements);
  removeFromFlow(flow, ["F2", "F2#invite", "D1->F2"]);
  untouchedExcept(flow, elements, [node(flow, "F1").id, node(flow, "D1").id, "hand0001"]);
  sound(flow);
});

/**
 * A pasted copy of F2's image and label, in a group of their own, as
 * Excalidraw pastes; `legacy` strips the data's `id`, as data written before
 * elements recorded it.
 */
function paste(flow: Flow, { grouped = true, legacy = false } = {}) {
  const image = node(flow, "F2");
  const label = flow.elements.find((e) => e.text === "F2 · b")!;
  const copies = [label, image].map((e, i): ExcalidrawElementJson => ({
    ...structuredClone(e),
    id: `copy000${i}`,
    x: Number(e.x) + 2000,
    boundElements: null,
    groupIds: grouped ? ["pasted01"] : [],
  }));
  if (legacy)
    for (const e of [label, image, ...copies])
      delete (e.customData as { wiredown: { id?: string } }).wiredown.id;
  flow.elements.push(...copies);
  return copies;
}

test("a pasted copy is a person's: lint names it once, its id removes the paste", () => {
  const flow = build();
  const [label, image] = paste(flow);
  const before = structuredClone(flow.elements);
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F2",
      element: image.id,
      message: `element ${image.id} is a copy of F2's frame; flow commands leave copies alone: delete it in the drawing, or run "wiredown flow remove <flow> ${image.id}"`,
    },
  ]);
  expect(removeFromFlow(flow, [label.id]).removed).toEqual([
    {
      kind: "copy",
      element: label.id,
      elements: [label.id, image.id],
      node: "F2",
      of: "F2's label",
    },
  ]);
  untouchedExcept(flow, before, []);
  sound(flow);
});

test("copies of a note, a highlight and an arrow survive their node's removal", () => {
  const flow = build();
  const f2 = node(flow, "F2");
  const group = (f2.groupIds as string[])[0];
  const note = role(flow, "note", (e) => e.text === "First")[0];
  const [highlight] = role(flow, "highlight");
  const arrow = role(flow, "arrow", (e) => identity(e)!.from === "F2")[0];
  // Alt-dragged inside F2's group, retyped and recoloured; the arrow pasted bound to F2
  const copies: ExcalidrawElementJson[] = [
    { ...structuredClone(note), id: "copynote", text: "Mine", rawText: "Mine" },
    { ...structuredClone(highlight), id: "copyhigh", strokeColor: "#ff0000" },
    { ...structuredClone(arrow), id: "copyarro", boundElements: null, groupIds: [] },
  ];
  flow.elements.push(...copies);
  for (const n of [f2, node(flow, "F1")])
    (n.boundElements as unknown[]).push({ id: "copyarro", type: "arrow" });
  expect(lintFlow(flow, screens).map((f) => [f.element, f.message.split(";")[0]])).toEqual([
    ["copynote", "element copynote is a copy of F2's note"],
    ["copyhigh", "element copyhigh is a copy of F2's highlight"],
    ["copyarro", "element copyarro is a copy of arrow F2 -> F1"],
  ]);
  expect(copies[0].groupIds).toEqual([group]);
  const { removed, unbound } = removeFromFlow(flow, ["F2"]);
  expect(removed[0]).toMatchObject({ notes: 2, overlays: 2, arrows: 3 });
  expect(unbound).toEqual([
    { element: "hand0001", from: "F2" },
    { element: "copyarro", from: "F2" },
  ]);
  expect(copies.map((e) => e.isDeleted)).toEqual([false, false, false]);
  expect(byId(flow, "copyarro")).toMatchObject({ startBinding: null });
  removeFromFlow(
    flow,
    copies.map((e) => e.id),
  );
  sound(flow);
});

test("a copy from before elements recorded their id: removed by its image's id", () => {
  const flow = build();
  const [label, image] = paste(flow, { legacy: true });
  const before = structuredClone(flow.elements);
  const original = node(flow, "F2");
  const claimed = `F2 is claimed by elements ${original.id} and copy0001; remove the copy with "wiredown flow remove <flow> <id>"`;
  expect(lintFlow(flow, screens).map((f) => f.message)).toEqual([claimed]);
  expect(() => removeFromFlow(flow, ["F2"])).toThrow(claimed);
  expect(() => removeFromFlow(flow, ["F2#invite"])).toThrow(claimed);
  expect(removeFromFlow(flow, [image.id]).removed).toEqual([
    {
      kind: "frame",
      element: image.id,
      elements: [image.id, label.id],
      node: "F2",
      notes: 0,
      overlays: 0,
      arrows: 0,
      copy: true,
    },
  ]);
  untouchedExcept(flow, before, []);
  sound(flow);
});

test("such a copy without a group of its own leaves the labels and says so", () => {
  const flow = build();
  const [label, image] = paste(flow, { grouped: false, legacy: true });
  const { removed } = removeFromFlow(flow, [image.id]);
  expect(removed[0]).toMatchObject({ elements: [image.id], copy: true, labelLeft: true });
  // the stray label is ours, so it goes by its id
  expect(removeFromFlow(flow, [label.id]).removed).toEqual([
    { kind: "label", element: label.id, elements: [label.id], node: "F2" },
  ]);
  sound(flow);
});

test("notes and overlays whose node is gone are removed by element id", () => {
  const flow = build();
  // a person deleted F2's image in Excalidraw, and with it its arrows' bindings
  const f2 = node(flow, "F2");
  removeFromFlow(
    flow,
    role(flow, "arrow").map((e) => e.id),
  );
  f2.isDeleted = true;
  byId(flow, "hand0001").startBinding = null;
  const orphans = lintFlow(flow, screens);
  const ids = orphans.map((f) => f.element!);
  expect(orphans.map((f) => f.message)).toEqual([
    `note "Second" is on a node that no longer exists; remove it with "wiredown flow remove <flow> ${ids[0]}"`,
    `note "First" is on a node that no longer exists; remove it with "wiredown flow remove <flow> ${ids[1]}"`,
    `highlight #invite is on a frame that no longer exists; remove it with "wiredown flow remove <flow> ${ids[2]}"`,
    `mark 3 #invite is on a frame that no longer exists; remove it with "wiredown flow remove <flow> ${ids[3]}"`,
  ]);
  expect(() => removeFromFlow(flow, ["F2:note"])).toThrow('unknown node "F2"');
  removeFromFlow(flow, ids);
  // the frame label a person left behind is ours too
  removeFromFlow(flow, [flow.elements.find((e) => e.text === "F2 · b")!.id]);
  sound(flow);
});

test("a person's text bound to a removed shape is detached, never deleted", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "a", title: "a", path: "screens", size: home });
  const mark = addMark(flow, "F1", { target: "invite", box, screen: home, label: "3" });
  const ellipse = flow.elements.find((e) => e.id === mark)!;
  const theirs: ExcalidrawElementJson = {
    ...{ id: "person01", type: "text", x: 0, y: 0, width: 10, height: 10, version: 1 },
    ...{ text: "mine", rawText: "mine", containerId: mark },
  };
  flow.elements.push(theirs);
  ellipse.boundElements = [
    ...(ellipse.boundElements as { id: string }[]),
    { id: "person01", type: "text" },
  ];
  removeFromFlow(flow, ["F1#invite:3"]);
  expect(theirs).toMatchObject({ containerId: null, version: 2 });
  expect(theirs.isDeleted).toBeFalsy();
  expect(ellipse.isDeleted).toBe(true);
});

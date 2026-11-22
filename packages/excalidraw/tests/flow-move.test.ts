import { expect, test } from "vitest";
import { identity } from "../src/flow-edit";
import {
  addDecision,
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  flowNodes,
  lintFlow,
  moveNode,
  newFlow,
  parseFlow,
  serializeFlow,
} from "../src/index";
import type { ExcalidrawElementJson, Flow, ScreenState } from "../src/index";
import { bindingFailures, pluginFailures } from "./plugin-checks";

const box = { x: 20, y: 30, w: 40, h: 50 };
const home: ScreenState = { width: 100, height: 200, boxes: { invite: box } };
const screens = () => ({ ok: true as const, screen: home });

/**
 * F1 -> F2 (labelled), F2 -> F1, F1 -> D1 below F1; a note, a highlight and a
 * mark on F1; in F1's group a person's rectangle and a person's copy of the
 * note; and a person's arrow from F1 to F2.
 */
function build() {
  const flow = newFlow();
  for (const id of ["a", "b"])
    addScreen(flow, { screenId: id, title: id, path: "screens", size: home });
  addDecision(flow, { text: "Ok?", place: { below: "F1" } });
  connect(flow, "F1", "F2", { label: "Go" });
  connect(flow, "F2", "F1");
  connect(flow, "F1", "D1");
  const note = addNote(flow, "F1", "A note");
  const overlay = { target: "invite", box, screen: home };
  addHighlight(flow, "F1", overlay);
  addMark(flow, "F1", { ...overlay, label: "3" });
  const [f1, f2] = ["F1", "F2"].map((n) => node(flow, n));
  const group = (f1.groupIds as string[])[0];
  const n = byId(flow, note);
  flow.elements.push(
    { id: "rect0001", type: "rectangle", x: 10, y: 10, width: 10, height: 10, groupIds: [group] },
    { ...structuredClone(n), id: "copy0001", y: Number(n.y) + 30, text: "Mine" },
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
  return parseFlow(serializeFlow(flow));
}
const byId = (flow: Flow, id: string) => flow.elements.find((e) => e.id === id)!;
const node = (flow: Flow, name: string) => flowNodes(flow).find((n) => n.node === name)!.element;
const at = (e: ExcalidrawElementJson) => [Number(e.x), Number(e.y)];
/** F1's elements of ours besides arrows: its image, label, note, overlays and the mark's text. */
const parts = (flow: Flow) =>
  flow.elements.filter((e) => {
    const d = identity(e);
    return d && !d.from && (e === node(flow, "F1") || d.frame === "F1" || d.node === "F1");
  });
const theirs = ["rect0001", "copy0001", "hand0001"];

/** Lint finds only what it found before; plugin-clean, and written as it reads. */
function sound(flow: Flow, lint: unknown) {
  expect(lintFlow(flow, screens)).toEqual(lint);
  const text = serializeFlow(flow);
  expect(pluginFailures(text)).toEqual([]);
  expect(bindingFailures(text)).toEqual([]);
  expect(serializeFlow(parseFlow(text))).toBe(text);
}

test.each([
  ["--right-of", { rightOf: "F2" }, (f: Flow) => [Number(node(f, "F2").x) + 120 + 340, 0]],
  ["--below", { below: "D1" }, (f: Flow) => [0, Number(node(f, "D1").y) + 170 + 340]],
  ["--to", { x: -1000, y: 500 }, () => [-1000, 500]],
] as const)("%s moves the node and what of ours belongs to it by one delta", (_, to, want) => {
  const flow = build();
  const lint = lintFlow(flow, screens); // the person's copy of the note
  expect(lint).toHaveLength(1);
  const [x, y] = want(flow);
  const before = new Map(flow.elements.map((e) => [e.id, structuredClone(e)]));
  const mine = parts(flow);
  expect(mine).toHaveLength(6);
  const f1 = node(flow, "F1");
  const [x0, y0] = at(f1);
  const { changes, elements, ...moved } = moveNode(flow, "F1", to);
  expect(moved).toEqual({
    node: "F1",
    kind: "frame",
    element: f1.id,
    x,
    y,
    width: f1.width,
    height: f1.height,
    notes: 1,
    overlays: 2,
    arrows: 3,
    unresolved: [],
  });
  expect(elements[0]).toBe(f1.id);
  expect([...elements].sort()).toEqual(mine.map((e) => e.id).sort());
  // each re-routed arrow as refresh reports it, with its new geometry; `frame`
  // is the first node an end missed, which a move can make either one
  const arrows = flow.elements.filter((e) => e.type === "arrow" && identity(e));
  expect(changes).toEqual(
    arrows.map((a) => {
      const { from, to } = identity(a)!;
      const [x, y, width, height] = [a.x, a.y, a.width, a.height].map(Number);
      const frame = expect.stringMatching(/^(F1|F2|D1)$/);
      return { frame, kind: "arrow", element: a.id, from, to, x, y, width, height };
    }),
  );
  for (const e of mine) {
    const [bx, by] = at(before.get(e.id)!);
    expect(at(e)).toEqual([bx + x - x0, by + y - y0]);
  }
  // a person's rectangle, copy of the note and arrow stay exactly as they were
  for (const id of theirs) expect(byId(flow, id)).toEqual(before.get(id));
  sound(flow, lint);
});

test("our arrows are re-routed as connect places them; a bent one is left and reported", () => {
  const flow = build();
  const bent = flow.elements.find((e) => identity(e)?.from === "F2" && e.type === "arrow")!;
  bent.points = [
    [0, 0],
    [-170, 60],
    [-340, 0],
  ];
  const before = structuredClone(bent);
  const moved = moveNode(flow, "F1", { x: 0, y: -1000 });
  expect(moved.arrows).toBe(2);
  const why = "it was bent by hand and no longer meets F1; straighten or move it in the drawing";
  // each entry also carries the arrow's geometry, as refresh's changes do
  expect(moved.unresolved).toMatchObject([
    { frame: "F1", kind: "arrow", element: bent.id, from: "F2", to: "F1", unresolved: why },
  ]);
  expect(bent).toEqual(before);
  // the straight ones meet their nodes: lint reports only the bent one, as move did
  const lint = lintFlow(flow, screens);
  expect(lint.filter((f) => f.message.includes("no longer meets"))).toEqual([
    { frame: "F1", element: bent.id, message: `arrow F2 -> F1: ${why}` },
  ]);
});

test("a decision moves with its text and notes", () => {
  const flow = build();
  addNote(flow, "D1", "Why");
  const d1 = node(flow, "D1");
  const text = flow.elements.find((e) => e.containerId === d1.id)!;
  const note = flow.elements.find(
    (e) => identity(e)?.role === "note" && identity(e)?.node === "D1",
  )!;
  const [tx, ty, nx, ny] = [...at(text), ...at(note)];
  const moved = moveNode(flow, "D1", { x: Number(d1.x) + 100, y: Number(d1.y) + 50 });
  expect(moved).toMatchObject({ node: "D1", kind: "decision", notes: 1, arrows: 1 });
  expect([...at(text), ...at(note)]).toEqual([tx + 100, ty + 50, nx + 100, ny + 50]);
});

test("refusals change nothing", () => {
  const flow = build();
  const before = serializeFlow(flow);
  const f2 = node(flow, "F2");
  expect(() => moveNode(flow, "F9", { x: 0, y: 0 })).toThrow(
    'unknown node "F9" (nodes: F1, F2, D1)',
  );
  expect(() => moveNode(flow, "F1", { rightOf: "F1" })).toThrow(
    "cannot place F1 relative to itself",
  );
  expect(() => moveNode(flow, "F1", { x: Number(f2.x) - 50, y: 100 })).toThrow(
    `F1 at ${Number(f2.x) - 50},100 would overlap F2; pick another place`,
  );
  expect(serializeFlow(flow)).toBe(before);
  const copy = structuredClone(f2);
  copy.id = "claim001";
  delete (copy.customData as { wiredown: { id?: string } }).wiredown.id;
  delete (identity(f2) as { id?: string }).id;
  flow.elements.push(copy);
  const claimed = serializeFlow(flow);
  expect(() => moveNode(flow, "F1", { x: 0, y: 2000 })).toThrow(
    `F2 is claimed by elements ${f2.id} and claim001`,
  );
  expect(serializeFlow(flow)).toBe(claimed);
});

test("touching a node is not an overlap", () => {
  const flow = build();
  const f2 = node(flow, "F2");
  moveNode(flow, "F1", { x: Number(f2.x) - Number(f2.width), y: 0 });
  expect(lintFlow(flow, screens).filter((f) => f.message.includes("overlaps"))).toEqual([]);
});

test("lint offers a below example when the space right of F1 is occupied", () => {
  const flow = build();
  const f2 = node(flow, "F2");
  const f1 = node(flow, "F1");
  Object.assign(node(flow, "D1"), { x: -2000 });
  addScreen(flow, {
    screenId: "home",
    title: "Third",
    path: "screens",
    size: { width: 100, height: 200 },
  });
  Object.assign(node(flow, "F3"), { x: f2.x, y: f2.y });
  Object.assign(f2, { x: 50 });
  const finding = lintFlow(flow, screens).find((f) => f.message.startsWith("overlaps"));
  expect(finding).toEqual({
    frame: "F2",
    element: f2.id,
    message:
      'overlaps F1; move one of them in the drawing, or with "wiredown flow move", e.g. "wiredown flow move <flow> F2 --below F1"',
  });
  expect(() => moveNode(flow, "F2", { rightOf: "F1" })).toThrow("would overlap F3");
  moveNode(flow, "F2", { below: "F1" });
  expect(Number(f2.y)).toBe(Number(f1.height) + 340);
  expect(lintFlow(flow, screens).filter((f) => f.message.startsWith("overlaps"))).toEqual([]);
});

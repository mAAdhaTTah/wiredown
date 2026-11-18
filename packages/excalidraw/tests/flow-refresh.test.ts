import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { identity } from "../src/flow-edit.js";
import {
  addDecision,
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  flowFrames,
  flowNodes,
  lintFlow,
  newFlow,
  overlayBox,
  parseFlow,
  refreshFlow,
  serializeFlow,
} from "../src/index.js";
import type { ExcalidrawElementJson, Flow, ScreenRef, ScreenState } from "../src/index.js";
import { bindingFailures, pluginFailures } from "./plugin-checks.js";

const box = { x: 20, y: 30, w: 40, h: 50 };
const home: ScreenState = { width: 100, height: 200, boxes: { invite: box } };
const other: ScreenState = { width: 300, height: 100, boxes: {} };
// the home screen after a row was added and it grew wider
const grown: ScreenState = {
  width: 140,
  height: 260,
  boxes: { invite: { x: 30, y: 90, w: 60, h: 50 } },
};
/** Screens by `path#^id`, or by block id for any path. */
const lookup =
  (screens: Record<string, ScreenState>) =>
  ({ path, blockId }: ScreenRef): ScreenState | string =>
    screens[`${path}#^${blockId}`] ?? screens[blockId] ?? `but ${path}.md has no ^${blockId}`;

/** F1 (home) -> F2 (other), a highlight and a mark on F1, a note, and a person's text. */
function build() {
  const flow = newFlow();
  // right of it, the first frame lands at x 0
  flow.elements.push({
    ...{ id: "personal", type: "text", x: -400, y: 0, width: 60, height: 20 },
    ...{ text: "Mine", rawText: "Mine" },
  });
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  addScreen(flow, { screenId: "other", title: "Other", path: "screens", size: other });
  const arrow = connect(flow, "F1", "F2", { label: "Go" });
  const note = addNote(flow, "F1", "A note");
  const overlay = { target: "invite", box, screen: home };
  const hi = addHighlight(flow, "F1", overlay);
  const mark = addMark(flow, "F1", { ...overlay, label: "3" });
  return { flow, hi, mark, arrow, note };
}
const byId = (flow: Flow, id: string) => flow.elements.find((e) => e.id === id)!;
const points = (a: ExcalidrawElementJson) => {
  const [dx, dy] = (a.points as number[][]).at(-1)!;
  return [Number(a.x), Number(a.y), Number(a.x) + dx, Number(a.y) + dy];
};
const image = (flow: Flow, frame: string) =>
  flowFrames(flow).find((f) => f.frame === frame)!.element;
const centre = (e: ExcalidrawElementJson) => ({
  x: Number(e.x) + Number(e.width) / 2,
  y: Number(e.y) + Number(e.height) / 2,
});
function valid(flow: Flow) {
  const out = serializeFlow(flow);
  expect(pluginFailures(out)).toEqual([]);
  expect(bindingFailures(out)).toEqual([]);
  expect(serializeFlow(parseFlow(out))).toBe(out);
  return out;
}

test("a fresh flow lints clean and refresh is a no-op", () => {
  const { flow } = build();
  const before = valid(flow);
  const screens = lookup({ home, other });
  expect(lintFlow(flow, screens)).toEqual([]);
  expect(refreshFlow(flow, screens)).toEqual([]);
  expect(serializeFlow(flow)).toBe(before);
  // and after a round trip through the file
  const read = parseFlow(before);
  expect(refreshFlow(read, screens)).toEqual([]);
  expect(serializeFlow(read)).toBe(before);
});

test("a grown screen: lint reports it, refresh fixes it, lint is clean", () => {
  const { flow, hi, mark, arrow, note } = build();
  const moving = [hi, mark, arrow, note, image(flow, "F1").id];
  const untouched = flow.elements
    .filter((e) => !moving.includes(e.id) && !moving.includes(String(e.containerId)))
    .map((e) => structuredClone(e));
  const screens = lookup({ home: grown, other });
  const img = image(flow, "F1");
  const findings = lintFlow(flow, screens);
  expect(findings).toEqual([
    {
      frame: "F1",
      element: img.id,
      message: "stale embed size: 120x245, but ^home now needs 160x305",
    },
    { frame: "F1", element: hi, message: "stale overlay: highlight #invite is not on #invite" },
    { frame: "F1", element: mark, message: "stale overlay: mark 3 #invite is not on #invite" },
  ]);
  const version = Number(img.version);
  const changes = refreshFlow(flow, screens);
  expect(changes).toEqual([
    {
      frame: "F1",
      kind: "embed",
      element: img.id,
      link: { from: { width: 120, height: 245 }, to: { width: 160, height: 305 } },
      image: { from: { width: 120, height: 205 }, to: { width: 160, height: 265 } },
    },
    { frame: "F1", kind: "note", element: note },
    { frame: "F1", kind: "highlight", element: hi, target: "invite" },
    { frame: "F1", kind: "mark", element: mark, target: "invite", label: "3" },
    { frame: "F1", kind: "arrow", element: arrow, from: "F1", to: "F2" },
  ]);
  expect(img).toMatchObject({ x: 0, y: 0, width: 160, height: 265, version: version + 1 });
  // the note keeps its gap under the frame; the arrow leaves F1's new port
  expect(byId(flow, note).y).toBe(265 + 20);
  expect(points(byId(flow, arrow)).slice(0, 2)).toEqual([160 + 6, 265 / 2]);
  expect(flow.embeds.get(String(img.fileId))).toMatchObject({ width: 160, height: 305 });
  // exactly where addHighlight and addMark would put them on the new layout
  const fresh = newFlow();
  addScreen(fresh, { screenId: "home", title: "Home", path: "screens", size: grown });
  const overlay = { target: "invite", box: grown.boxes.invite, screen: grown };
  const want = byId(fresh, addHighlight(fresh, "F1", overlay));
  const wantMark = byId(fresh, addMark(fresh, "F1", { ...overlay, label: "3" }));
  for (const k of ["x", "y", "width", "height"]) expect(byId(flow, hi)[k]).toBe(want[k]);
  expect(centre(byId(flow, mark))).toEqual(centre(wantMark));
  const label = flow.elements.find((e) => e.containerId === mark)!;
  expect(centre(label)).toEqual(centre(wantMark));
  expect(Number(byId(flow, hi).version)).toBe(2);
  expect(lintFlow(flow, screens)).toEqual([]);
  expect(refreshFlow(flow, screens)).toEqual([]);
  const others = flow.elements.filter((e) => untouched.some((u) => u.id === e.id));
  expect(others).toEqual(untouched);
  valid(flow);
});

test("a uniformly scaled frame is not stale; refresh keeps its scale", () => {
  const { flow, hi, mark, arrow } = build();
  const label = flow.elements.find((e) => identity(e)?.role === "label")!;
  const img = image(flow, "F1");
  Object.assign(img, { x: 50, y: 70, width: 60, height: 102.5 });
  const screens = lookup({ home, other });
  // the overlays and arrow were placed on the unscaled frame, so only they are stale
  expect(lintFlow(flow, screens).map((f) => f.element)).toEqual([label.id, hi, mark, arrow]);
  expect(refreshFlow(flow, screens).map((c) => c.kind)).toEqual([
    "highlight",
    "mark",
    "label",
    "arrow",
  ]);
  expect(img).toMatchObject({ x: 50, y: 70, width: 60, height: 102.5 });
  const b = overlayBox(img, home, box);
  expect(byId(flow, hi)).toMatchObject({
    x: b.x - 4,
    y: b.y - 4,
    width: b.width + 8,
    height: b.height + 8,
  });
  expect(lintFlow(flow, screens)).toEqual([]);
  // grown, at half scale: 160x265 at 0.5
  const big = lookup({ home: grown, other });
  refreshFlow(flow, big);
  expect(img).toMatchObject({ x: 50, y: 70, width: 80, height: 132.5 });
  expect(lintFlow(flow, big)).toEqual([]);
});

test("a changed aspect is stale even when the link size is current", () => {
  const { flow } = build();
  const img = image(flow, "F1");
  img.height = 300;
  const screens = lookup({ home, other });
  expect(lintFlow(flow, screens)[0]).toEqual({
    frame: "F1",
    element: img.id,
    message: "stale image: 120x300 no longer has the aspect of ^home",
  });
  expect(refreshFlow(flow, screens)[0]).toMatchObject({
    kind: "embed",
    image: { from: { width: 120, height: 300 }, to: { width: 120, height: 205 } },
  });
  expect(lintFlow(flow, screens)).toEqual([]);
});

test("a hand-moved frame keeps its position", () => {
  const { flow, hi } = build();
  const img = image(flow, "F1");
  Object.assign(img, { x: -300, y: 400 });
  const screens = lookup({ home: grown, other });
  refreshFlow(flow, screens);
  expect(img).toMatchObject({ x: -300, y: 400, width: 160, height: 265 });
  expect(Number(byId(flow, hi).x)).toBe(-300 + 10 + 30 - 4);
  expect(lintFlow(flow, screens)).toEqual([]);
});

test("an overlay whose target is gone is left in place and reported", () => {
  const { flow, hi, mark } = build();
  const screens = lookup({ home: { ...grown, boxes: {} }, other });
  const before = structuredClone(byId(flow, hi));
  const changes = refreshFlow(flow, screens);
  expect(changes.filter((c) => "unresolved" in c)).toEqual([
    {
      frame: "F1",
      kind: "highlight",
      element: hi,
      target: "invite",
      unresolved: "^home has no #invite any more",
    },
    {
      frame: "F1",
      kind: "mark",
      element: mark,
      target: "invite",
      label: "3",
      unresolved: "^home has no #invite any more",
    },
  ]);
  expect(byId(flow, hi)).toEqual(before);
  expect(lintFlow(flow, screens).map((f) => f.message)).toEqual([
    "highlight #invite: ^home has no #invite any more",
    "mark 3 #invite: ^home has no #invite any more",
  ]);
});

test("an overlay whose frame is gone is reported and left alone", () => {
  const { flow, hi } = build();
  image(flow, "F1").isDeleted = true;
  const screens = lookup({ home, other });
  expect(refreshFlow(flow, screens)).toContainEqual({
    frame: "F1",
    kind: "highlight",
    element: hi,
    target: "invite",
    unresolved: "F1 no longer exists",
  });
  expect(lintFlow(flow, screens)).toContainEqual({
    frame: "F1",
    element: hi,
    message: "highlight #invite is on a frame that no longer exists",
  });
});

test("a frame whose screen is missing is an error; refresh skips it", () => {
  const { flow } = build();
  const before = serializeFlow(flow);
  const screens = lookup({ home });
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F2",
      element: image(flow, "F2").id,
      message: "embeds [[screens#^other]], but screens.md has no ^other",
    },
  ]);
  expect(refreshFlow(flow, screens)).toEqual([]);
  expect(serializeFlow(flow)).toBe(before);
});

test("dangling arrows: a deleted node, and a hand-drawn arrow bound to nothing", () => {
  const { flow } = build();
  const screens = lookup({ home, other });
  const f2 = image(flow, "F2");
  f2.isDeleted = true;
  const arrow = flow.elements.find((e) => e.type === "arrow")!;
  expect(lintFlow(flow, screens)).toEqual([
    {
      element: arrow.id,
      message: `arrow F1 -> F2: its end is bound to image ${f2.id}, which is deleted`,
    },
  ]);
  f2.isDeleted = false;
  // our arrow's node record lost while the binding still works
  (arrow.customData as { wiredown: { to: string } }).wiredown.to = "F9";
  expect(lintFlow(flow, screens)).toEqual([
    { element: arrow.id, message: "arrow F1 -> F9: F9 no longer exists" },
  ]);
  (arrow.customData as { wiredown: { to: string } }).wiredown.to = "F2";
  flow.elements.push(
    { id: "drawn", type: "arrow", x: 0, y: 0, startBinding: { elementId: "gone" } },
    { id: "loose", type: "arrow", x: 0, y: 0, startBinding: null, endBinding: null },
    { id: "unlisted", type: "arrow", x: 0, y: 0, endBinding: { elementId: "personal" } },
  );
  expect(lintFlow(flow, screens)).toEqual([
    { element: "drawn", message: "arrow drawn: its start is bound to gone, which does not exist" },
    {
      element: "unlisted",
      message:
        "arrow unlisted: its end is bound to text personal, which does not list it in boundElements",
    },
  ]);
});

test("an image without an embedded-files entry", () => {
  const { flow } = build();
  const img = image(flow, "F2");
  flow.embeds.delete(String(img.fileId));
  flow.elements.push({ id: "pasted", type: "image", x: 0, y: 0, fileId: "abc" });
  const findings = lintFlow(flow, lookup({ home, other }));
  expect(findings).toEqual([
    {
      frame: "F2",
      element: img.id,
      message: `image ${img.id} has no ## Embedded Files entry for ${String(img.fileId)}`,
    },
    { element: "pasted", message: "image pasted has no ## Embedded Files entry for abc" },
  ]);
  expect(refreshFlow(flow, lookup({ home: grown, other: grown }))[0].frame).toBe("F1");
});

test("a hand-made screen embed is linted for its screen, and left alone by refresh", () => {
  const text = readFileSync(
    new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url),
    "utf8",
  );
  const flow = parseFlow(text);
  const size = { width: 100, height: 100, boxes: {} };
  const known = { "simplified-tree": size, "review-view": size };
  expect(lintFlow(flow, lookup(known)).map((f) => f.message)).toEqual([
    "an image embeds [[screens#^review-applied]], but screens.md has no ^review-applied",
  ]);
  expect(refreshFlow(flow, lookup(known))).toEqual([]);
  expect(serializeFlow(flow)).toBe(text);
});

test("lint reports each live text id the plugin cannot track without renaming it", () => {
  const flow = newFlow();
  flow.elements.push(
    { id: "short", type: "text", x: 0, y: 0 },
    { id: "too-long-id", type: "text", x: 0, y: 0 },
    { id: "deleted", type: "text", x: 0, y: 0, isDeleted: true },
  );
  const findings = lintFlow(flow, () => "none");
  expect(findings).toEqual(
    ["short", "too-long-id"].map((id) => ({
      element: id,
      message: `text element "${id}" has an id that is not 8 characters; the Excalidraw plugin cannot track it, and flow commands cannot save this drawing until it is renamed`,
    })),
  );
  expect(flow.elements.map((e) => e.id)).toEqual(["short", "too-long-id", "deleted"]);
});

test("each embed is looked up by its path and block id", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "a/screens", size: home });
  addScreen(flow, { screenId: "home", title: "Home", path: "b/screens", size: grown });
  addScreen(flow, { screenId: "home", title: "Home", path: "c/screens", size: home });
  const screens = lookup({ "a/screens#^home": home, "b/screens#^home": grown });
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F3",
      element: image(flow, "F3").id,
      message: "embeds [[c/screens#^home]], but c/screens.md has no ^home",
    },
  ]);
  expect(refreshFlow(flow, screens)).toEqual([]);
});

test("overlays follow their frame's image by id; copies and other screens are reported", () => {
  const { flow, hi, mark } = build();
  const screens = lookup({ home, other });
  const f1 = image(flow, "F1");
  // a frame renamed by hand keeps its overlays (only its arrow's record is off)
  (f1.customData as { wiredown: { frame: string } }).wiredown.frame = "F7";
  expect(lintFlow(flow, screens).map((f) => f.message)).toEqual([
    "arrow F1 -> F2: F1 no longer exists",
  ]);
  (f1.customData as { wiredown: { frame: string } }).wiredown.frame = "F1";
  // a pasted copy of F1 is a person's element; its overlays still belong to the original
  const copy: ExcalidrawElementJson = { ...structuredClone(f1), id: "copy0001", x: 900 };
  flow.elements.push(copy);
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F1",
      element: "copy0001",
      message:
        "element copy0001 is a copy of F1's frame; flow commands leave copies alone: delete it in the drawing",
    },
  ]);
  expect(refreshFlow(flow, screens)).toEqual([]);
  // pasted before elements recorded their own id, it claims F1: refresh refuses
  delete (copy.customData as { wiredown: { id?: string } }).wiredown.id;
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F1",
      element: "copy0001",
      message: `F1 is claimed by elements ${f1.id} and copy0001; delete the copy`,
    },
  ]);
  const before = serializeFlow(flow);
  expect(() => refreshFlow(flow, lookup({ home: grown, other }))).toThrow(
    `F1 is claimed by elements ${f1.id} and copy0001; delete the copy`,
  );
  expect(serializeFlow(flow)).toBe(before);
  copy.isDeleted = true;
  // an overlay drawn for another screen than its frame embeds
  (byId(flow, hi).customData as { wiredown: { screen: string } }).wiredown.screen = "other";
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F1",
      element: hi,
      message: "highlight #invite was drawn on ^other, but F1 embeds ^home",
    },
  ]);
  // an overlay whose anchor is gone is on no frame, whatever its name says
  (byId(flow, mark).customData as { wiredown: { anchor: string } }).wiredown.anchor = "gone";
  expect(lintFlow(flow, screens).at(-1)).toEqual({
    frame: "F1",
    element: mark,
    message: "mark 3 #invite is on a frame that no longer exists",
  });
  expect(refreshFlow(flow, screens)).toContainEqual({
    frame: "F1",
    kind: "mark",
    element: mark,
    target: "invite",
    label: "3",
    unresolved: "F1 no longer exists",
  });
});

test("a pasted frame with its overlays and note: refresh moves only the original's", () => {
  const { flow, hi, note } = build();
  const f1 = image(flow, "F1");
  const group = (f1.groupIds as string[])[0];
  // Excalidraw pastes a group's elements with new ids, one new group, and the data verbatim
  const parts = flow.elements.filter((e) => (e.groupIds as string[] | undefined)?.[0] === group);
  const ids = new Map(parts.map((e, i) => [e.id, `pasted0${i}`]));
  for (const e of parts) {
    const copy = structuredClone(e);
    copy.id = ids.get(e.id)!;
    copy.y = Number(e.y) + 2000;
    copy.groupIds = ["pasted"];
    if (copy.containerId) copy.containerId = ids.get(String(copy.containerId));
    if (Array.isArray(copy.boundElements))
      copy.boundElements = (copy.boundElements as { id: string }[]).map((b) => ({
        ...b,
        id: ids.get(b.id) ?? b.id,
      }));
    flow.elements.push(copy);
  }
  // a person's Alt-dragged copy of the note, retyped, stays in F1's group
  flow.elements.push({ ...structuredClone(byId(flow, note)), id: "dragged1", text: "Mine now" });
  const copies = flow.elements.filter((e) => e.id.startsWith("pasted") || e.id === "dragged1");
  const before = structuredClone(copies);
  expect(lintFlow(flow, lookup({ home, other }))).toEqual([
    {
      frame: "F1",
      element: ids.get(f1.id),
      message: `element ${ids.get(f1.id)} is a copy of F1's frame; flow commands leave copies alone: delete it in the drawing`,
    },
    {
      frame: "F1",
      element: "dragged1",
      message:
        "element dragged1 is a copy of F1's note; flow commands leave copies alone: delete it in the drawing",
    },
  ]);
  const changes = refreshFlow(flow, lookup({ home: grown, other }));
  expect(changes.map((c) => c.element)).toEqual(expect.arrayContaining([f1.id, hi, note]));
  expect(changes.some((c) => copies.some((e) => e.id === c.element))).toBe(false);
  expect(copies).toEqual(before);
});

test("data from a newer wiredown is ignored, with one finding", () => {
  const { flow } = build();
  for (const e of flow.elements.filter((e) => e.customData))
    (e.customData as { wiredown: { v: number } }).wiredown.v = 3;
  expect(lintFlow(flow, lookup({ home, other }))).toEqual([
    { message: "this drawing was written by a newer wiredown (data version 3)" },
  ]);
  expect(flowFrames(flow)).toEqual([]);
  // a version that is not a number is ignored and reported the same way
  (flow.elements.find((e) => e.customData)!.customData as { wiredown: object }).wiredown = {
    v: "x",
  };
  expect(lintFlow(flow, lookup({ home, other }))[0].message).toContain("(data version 3)");
  for (const e of flow.elements.filter((e) => e.customData))
    (e.customData as { wiredown: object }).wiredown = { v: "x" };
  expect(lintFlow(flow, lookup({ home, other }))[0].message).toContain('(data version "x")');
});

test("a note whose frame or decision is gone is reported", () => {
  const { flow } = build();
  const screens = lookup({ home, other });
  addDecision(flow, { text: "Ok?" });
  const why = addNote(flow, "D1", "Why");
  const note = flow.elements.find((e) => identity(e)?.role === "note")!;
  image(flow, "F1").isDeleted = true;
  flowNodes(flow).find((n) => n.node === "D1")!.element.isDeleted = true;
  const notes = lintFlow(flow, screens).filter((f) => f.message.startsWith("note "));
  expect(notes).toEqual([
    { frame: "F1", element: note.id, message: 'note "A note" is on a node that no longer exists' },
    { frame: "D1", element: why, message: 'note "Why" is on a node that no longer exists' },
  ]);
});

const shrunk: ScreenState = { width: 100, height: 120, boxes: { invite: box } };
const add = (flow: Flow, screenId: string, size: ScreenState, place?: { below: string }) =>
  addScreen(flow, {
    screenId,
    title: screenId,
    path: "screens",
    size,
    ...(place ? { place } : {}),
  });
const label = (flow: Flow, arrow: string) => flow.elements.find((e) => e.containerId === arrow)!;
/** Refresh changed something; lint is then clean and a second refresh changes nothing. */
function settles(flow: Flow, screens: ReturnType<typeof lookup>) {
  expect(refreshFlow(flow, screens)).not.toEqual([]);
  expect(lintFlow(flow, screens)).toEqual([]);
  const out = valid(flow);
  expect(refreshFlow(flow, screens)).toEqual([]);
  expect(serializeFlow(flow)).toBe(out);
}

test("a flow an older refresh left stranded lints dirty, and refresh repairs it", () => {
  const { flow, hi, mark, arrow, note } = build();
  // what refresh did before it moved arrows and notes: only the embed grew
  const img = image(flow, "F1");
  Object.assign(img, { width: 160, height: 265 });
  const fileId = String(img.fileId);
  flow.embeds.set(fileId, { ...flow.embeds.get(fileId)!, width: 160, height: 305 });
  const screens = lookup({ home: grown, other });
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F1",
      element: note,
      message: `note "A note" overlaps F1; run "wiredown flow refresh" or move it`,
    },
    { frame: "F1", element: hi, message: "stale overlay: highlight #invite is not on #invite" },
    { frame: "F1", element: mark, message: "stale overlay: mark 3 #invite is not on #invite" },
    {
      frame: "F1",
      element: arrow,
      message: `arrow F1 -> F2 no longer meets F1; run "wiredown flow refresh"`,
    },
  ]);
  expect(refreshFlow(flow, screens).map((c) => [c.kind, c.element])).toEqual([
    ["note", note],
    ["highlight", hi],
    ["mark", mark],
    ["arrow", arrow],
  ]);
  expect(byId(flow, note).y).toBe(265 + 20);
  expect(points(byId(flow, arrow)).slice(0, 2)).toEqual([166, 132.5]);
  expect(lintFlow(flow, screens)).toEqual([]);
  const out = valid(flow);
  expect(refreshFlow(flow, screens)).toEqual([]);
  expect(serializeFlow(flow)).toBe(out);
});

test("an arrow to a frame below follows the grown frame's bottom edge", () => {
  const flow = newFlow();
  add(flow, "home", home);
  add(flow, "other", other, { below: "F1" });
  const arrow = connect(flow, "F1", "F2", { label: "Down" });
  addNote(flow, "F1", "Between");
  settles(flow, lookup({ home: grown, other }));
  const [sx, sy, ex, ey] = points(byId(flow, arrow));
  expect([sx, sy, ex, ey]).toEqual([80, 265 + 6, 160, 205 + 340 - 6]);
  expect(byId(flow, arrow).startBinding).toMatchObject({ fixedPoint: [0.5, 1] });
  // a lone arrow's label sits at its middle
  expect(centre(label(flow, arrow)).x).toBeCloseTo((sx + ex) / 2);
  expect(centre(label(flow, arrow)).y).toBeCloseTo((sy + ey) / 2);
});

test("parallel arrows keep their slots and labels one third from their start", () => {
  const { flow, arrow } = build();
  const back = connect(flow, "F2", "F1", { label: "Back" });
  const again = connect(flow, "F1", "F2");
  settles(flow, lookup({ home: grown, other }));
  expect(points(byId(flow, arrow))[1]).toBe(132.5);
  // offsets stay inside F2's 105px height: 52.5 either side of its port
  expect(points(byId(flow, back))[3]).toBe(132.5 + 52.5);
  expect(points(byId(flow, again))[1]).toBe(132.5 - 52.5);
  for (const id of [arrow, back]) {
    const [sx, sy, ex, ey] = points(byId(flow, id));
    expect(centre(label(flow, id)).x).toBeCloseTo(sx + (ex - sx) / 3);
    expect(centre(label(flow, id)).y).toBeCloseTo(sy + (ey - sy) / 3);
  }
});

test("arrows between a frame and a decision follow; the decision's notes stay", () => {
  const flow = newFlow();
  add(flow, "home", home);
  addDecision(flow, { text: "Ok?" });
  const there = connect(flow, "F1", "D1", { label: "Submit" });
  const back = connect(flow, "D1", "F1");
  const notes = [addNote(flow, "D1", "Why"), addNote(flow, "D1", "And why not")];
  const kept = notes.map((id) => structuredClone(byId(flow, id)));
  settles(flow, lookup({ home: grown }));
  expect(points(byId(flow, there)).slice(0, 2)).toEqual([166, 132.5]);
  expect(points(byId(flow, back))[3]).toBe(132.5 + 70);
  expect(notes.map((id) => byId(flow, id))).toEqual(kept);
});

test("a bent arrow is left alone and reported; a hand-drawn one is untouched", () => {
  const { flow, arrow } = build();
  const bent = byId(flow, arrow);
  // a person drags its middle: its ends stay where they meet the frames
  bent.points = [[0, 0], [100, -40], (bent.points as number[][])[1]];
  const f1 = image(flow, "F1");
  const drawn = {
    ...{ id: "drawnArw", type: "arrow", x: 126, y: 50, width: 214, height: 0 },
    ...{
      points: [
        [0, 0],
        [214, 0],
      ],
      startBinding: { elementId: f1.id, fixedPoint: [1, 0.25] },
    },
  };
  flow.elements.push(drawn);
  f1.boundElements = [...(f1.boundElements as object[]), { id: "drawnArw", type: "arrow" }];
  const screens = lookup({ home, other });
  expect(lintFlow(flow, screens)).toEqual([]);
  const before = [bent, drawn].map((e) => structuredClone(e));
  const changes = refreshFlow(flow, lookup({ home: grown, other }));
  const why = "it was bent by hand and no longer meets F1; straighten or move it in the drawing";
  const unresolved = { frame: "F1", kind: "arrow", element: arrow, from: "F1", to: "F2" };
  expect(changes.filter((c) => c.kind === "arrow")).toEqual([{ ...unresolved, unresolved: why }]);
  expect([byId(flow, arrow), byId(flow, "drawnArw")]).toEqual(before);
  // F1 grew under its start: lint reports it every time, and refresh leaves it
  expect(lintFlow(flow, lookup({ home: grown, other }))).toEqual([
    { frame: "F1", element: arrow, message: `arrow F1 -> F2: ${why}` },
  ]);
  expect(refreshFlow(flow, lookup({ home: grown, other }))).toEqual([
    { ...unresolved, unresolved: why },
  ]);
  expect([byId(flow, arrow), byId(flow, "drawnArw")]).toEqual(before);
});

test("stacked notes move together in order; a note moved away is restored", () => {
  const { flow, note } = build();
  const second = addNote(flow, "F1", "Second");
  const away = addNote(flow, "F1", "Moved away");
  Object.assign(byId(flow, away), { x: -300, y: 600 });
  const ys = [note, second].map((id) => Number(byId(flow, id).y));
  settles(flow, lookup({ home: grown, other }));
  expect([note, second].map((id) => byId(flow, id).y)).toEqual(ys.map((y) => y + 60));
  expect(byId(flow, away)).toMatchObject({ x: 0, y: 365, version: 2 });
});

test("a note dragged onto its frame is reported, and refresh puts it under", () => {
  const { flow, note } = build();
  const second = addNote(flow, "F1", "Second note with more than four words");
  byId(flow, second).y = 100;
  const screens = lookup({ home, other });
  expect(lintFlow(flow, screens)).toEqual([
    {
      frame: "F1",
      element: second,
      message: `note ${second} is 165 px from its place under F1; run "wiredown flow refresh"`,
    },
  ]);
  settles(flow, screens);
  // The note still in the stack stays; the displaced note follows it.
  expect(byId(flow, note).y).toBe(225);
  expect(byId(flow, second).y).toBe(225 + Number(byId(flow, note).height) + 20);
});

test.each([
  ["the screen grows", lookup({ home: grown, other }), () => {}],
  ["the screen shrinks", lookup({ home: shrunk, other }), () => {}],
  [
    "a node is moved by hand",
    lookup({ home, other }),
    (flow: Flow) => Object.assign(image(flow, "F2"), { x: 600, y: 500 }),
  ],
])("lint is clean exactly when refresh has nothing to do: %s", (_name, screens, change) => {
  const { flow } = build();
  connect(flow, "F2", "F1", { label: "Back" });
  addNote(flow, "F2", "Other note");
  expect(lintFlow(flow, lookup({ home, other }))).toEqual([]);
  expect(refreshFlow(flow, lookup({ home, other }))).toEqual([]);
  change(flow);
  expect(lintFlow(flow, screens)).not.toEqual([]);
  settles(flow, screens);
});

test("freshly built flows of every shape lint clean", () => {
  const screens = lookup({ home, other, grown });
  for (const [x, y] of [
    [1000, 50],
    [-1000, 50],
    [100, 900],
    [0, -1000],
  ]) {
    const flow = newFlow();
    add(flow, "home", home);
    add(flow, "grown", grown);
    const img = image(flow, "F2");
    const label = flow.elements.find((e) => identity(e)?.anchor === img.id)!;
    Object.assign(label, { x, y: y - 48 });
    Object.assign(img, { x, y });
    connect(flow, "F1", "F2", { label: "One" });
    connect(flow, "F2", "F1");
    connect(flow, "F1", "F2", { label: "Three" });
    addNote(flow, "F1", "Note");
    expect(lintFlow(flow, screens)).toEqual([]);
    expect(refreshFlow(flow, screens)).toEqual([]);
  }
  const flow = newFlow();
  add(flow, "home", home);
  addDecision(flow, { text: "A question that is long enough to grow the diamond?" });
  connect(flow, "F1", "D1", { label: "Submit" });
  connect(flow, "D1", "F1");
  add(flow, "other", other, { below: "D1" });
  connect(flow, "D1", "F2", { label: "no" });
  addNote(flow, "D1", "Why");
  addNote(flow, "F2", "Below");
  add(flow, "grown", grown);
  connect(flow, "F2", "F3");
  connect(flow, "F3", "D1");
  expect(lintFlow(flow, screens)).toEqual([]);
  expect(refreshFlow(flow, screens)).toEqual([]);
});

test("refresh repairs detached labels, notes and groups, preserving nudges and copies", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const frame = image(flow, "F1");
  const label = flow.elements.find((e) => identity(e)?.role === "label")!;
  delete identity(label)!.anchor; // older files still find their label
  const a = byId(flow, addNote(flow, "F1", "First"));
  const b = byId(flow, addNote(flow, "F1", "Second"));
  frame.x = Number(frame.x) + 448;
  for (const e of flow.elements) e.groupIds = [];
  const copy = { ...structuredClone(a), id: "copynote", x: 9000 };
  flow.elements.push(copy);
  const copyBefore = structuredClone(copy);
  const screens = lookup({ home });
  const findings = lintFlow(flow, screens).filter((f) => f.message.includes("px from"));
  expect(findings).toHaveLength(3);
  expect(findings.find((f) => f.element === label.id)?.message).toBe(
    'label is 448 px from its place above F1; run "wiredown flow refresh"',
  );
  for (const note of [a, b]) expect(findings.filter((f) => f.element === note.id)).toHaveLength(1);
  const changes = refreshFlow(flow, screens);
  expect(changes.filter((c) => c.kind === "label")).toHaveLength(1);
  expect(changes.filter((c) => c.kind === "note")).toHaveLength(2);
  expect(changes.filter((c) => c.kind === "group")).toHaveLength(4);
  expect(label.x).toBe(frame.x);
  expect(a.y).toBe(Number(frame.y) + Number(frame.height) + 20);
  expect(b.y).toBe(Number(a.y) + Number(a.height) + 20);
  expect(copy).toEqual(copyBefore);
  expect(lintFlow(flow, screens).filter((f) => f.message.includes("px from"))).toEqual([]);
  a.x = Number(a.x) + 20;
  a.y = Number(a.y) + 20;
  const before = structuredClone(a);
  expect(refreshFlow(flow, screens)).toEqual([]);
  expect(a).toEqual(before);
  expect(lintFlow(flow, screens).filter((f) => f.message.includes("px from"))).toEqual([]);
});

test("refresh restores a displaced note after a replacement note", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const away = byId(flow, addNote(flow, "F1", "Away"));
  away.y = Number(away.y) + 260;
  const kept = byId(flow, addNote(flow, "F1", "Kept"));
  const before = structuredClone(kept);
  refreshFlow(flow, lookup({ home }));
  expect(kept).toEqual(before);
  expect(away.y).toBe(Number(kept.y) + Number(kept.height) + 20);
});

test("lint reports each pair of overlapping nodes once, on the later one", () => {
  const flow = newFlow();
  add(flow, "home", home);
  add(flow, "other", other);
  add(flow, "home", home);
  addDecision(flow, { text: "Ok?" });
  const screens = lookup({ home, other });
  expect(lintFlow(flow, screens)).toEqual([]);
  // F3 buried inside F1 (refresh grew F1), and F2 just touching F1's right edge
  const [f1, f2, f3] = ["F1", "F2", "F3"].map((f) => image(flow, f));
  Object.assign(f1, { width: 800, height: 600 });
  Object.assign(f3, { x: 10, y: 10 });
  Object.assign(f2, { x: 800 });
  // a person's copy of F2's frame on top of F1 is a copy, not an overlap
  flow.elements.push({ ...structuredClone(f2), id: "copyOfF2", x: 100, y: 100 });
  const overlaps = lintFlow(flow, screens).filter((f) => f.message.startsWith("overlaps"));
  expect(overlaps).toEqual([
    { frame: "F3", element: f3.id, message: "overlaps F1; move one of them in the drawing" },
  ]);
  // the decision overlapping F2 by a pixel is reported; refresh moves no node
  const d1 = flowNodes(flow).find((n) => n.node === "D1")!.element;
  Object.assign(d1, { x: 800 + Number(f2.width) - 1, y: 0 });
  const at = () => flowNodes(flow).map(({ element: e }) => [e.x, e.y]);
  const before = at();
  refreshFlow(flow, screens);
  expect(at()).toEqual(before);
  expect(lintFlow(flow, screens).filter((f) => f.message.startsWith("overlaps"))).toEqual([
    { frame: "F3", element: f3.id, message: "overlaps F1; move one of them in the drawing" },
    { frame: "D1", element: d1.id, message: "overlaps F2; move one of them in the drawing" },
  ]);
});

test("displaced notes retain vertical order without holes", () => {
  const flow = newFlow();
  add(flow, "home", home);
  const notes = [0, 1, 2].map(() => byId(flow, addNote(flow, "F1", "Two\nlines")));
  for (const [i, y] of [500, 1000, 700].entries()) notes[i].y = y;
  refreshFlow(flow, lookup({ home }));
  const ordered = [notes[0], notes[2], notes[1]];
  expect(ordered[0].y).toBe(Number(image(flow, "F1").height) + 20);
  for (let i = 1; i < ordered.length; i++)
    expect(ordered[i].y).toBe(Number(ordered[i - 1].y) + Number(ordered[i - 1].height) + 20);
});

test("deleted notes and 40px nudges stay current; far frame and decision notes return", () => {
  const flow = newFlow();
  add(flow, "home", home);
  const notes = [0, 1, 2].map(() => byId(flow, addNote(flow, "F1", "Note")));
  for (const [i, note] of notes.entries()) Object.assign(note, { height: 60, y: 225 + i * 80 });
  notes[0].isDeleted = true;
  expect(lintFlow(flow, lookup({ home }))).toEqual([]);
  expect(refreshFlow(flow, lookup({ home }))).toEqual([]);
  notes[1].x = Number(notes[1].x) + 40;
  notes[1].y = Number(notes[1].y) + 40;
  const before = serializeFlow(flow);
  expect(lintFlow(flow, lookup({ home }))).toEqual([]);
  expect(refreshFlow(flow, lookup({ home }))).toEqual([]);
  expect(serializeFlow(flow)).toBe(before);
  addDecision(flow, { text: "Ok?" });
  const decision = byId(flow, addNote(flow, "D1", "Why"));
  for (const note of [notes[2], decision]) note.x = Number(note.x) + 448;
  expect(
    lintFlow(flow, lookup({ home })).filter((f) => f.message.includes("px from")),
  ).toHaveLength(2);
  refreshFlow(flow, lookup({ home }));
  expect(lintFlow(flow, lookup({ home }))).toEqual([]);
});

test("group repair matches lint, preserves personal groups and touches once", () => {
  const { flow, hi, mark, note } = build();
  const label = flow.elements.find((e) => identity(e)?.role === "label" && !e.containerId)!;
  for (const e of [label, byId(flow, hi), byId(flow, mark), byId(flow, note)]) e.groupIds = [];
  label.x = Number(label.x) + 448;
  const version = Number(label.version);
  expect(
    lintFlow(flow, lookup({ home, other })).filter((f) => f.message.includes("not grouped")),
  ).toHaveLength(4);
  refreshFlow(flow, lookup({ home, other }));
  expect(label.version).toBe(version + 1);
  expect(lintFlow(flow, lookup({ home, other }))).toEqual([]);
  const before = serializeFlow(flow);
  expect(refreshFlow(flow, lookup({ home, other }))).toEqual([]);
  expect(serializeFlow(flow)).toBe(before);
  label.groupIds = ["PERSON"];
  const rectangle = {
    id: "personalrect",
    type: "rectangle",
    x: -900,
    y: -900,
    width: 20,
    height: 20,
    groupIds: ["PERSON"],
  };
  flow.elements.push(rectangle);
  const personal = JSON.stringify([label, rectangle]);
  expect(lintFlow(flow, lookup({ home, other }))).toEqual([]);
  expect(refreshFlow(flow, lookup({ home, other }))).toEqual([]);
  expect(JSON.stringify([label, rectangle])).toBe(personal);
});

test("ambiguous legacy labels are neither checked for distance nor moved", () => {
  const flow = newFlow();
  add(flow, "home", home);
  const label = flow.elements.find((e) => identity(e)?.role === "label")!;
  delete identity(label)!.anchor;
  delete identity(label)!.id;
  const copy = { ...structuredClone(label), id: "oldlabel", x: 9000 };
  flow.elements.push(copy);
  const before = JSON.stringify([label, copy]);
  expect(lintFlow(flow, lookup({ home })).filter((f) => f.message.includes("px from"))).toEqual([]);
  refreshFlow(flow, lookup({ home }));
  expect(JSON.stringify([label, copy])).toBe(before);
});

test("personally grouped displaced notes stay untouched and leave the stack free", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const note = byId(flow, addNote(flow, "F1", "Mine"));
  note.groupIds = ["mine"];
  note.y = Number(note.y) + 900;
  const before = structuredClone(note);
  expect(lintFlow(flow, lookup({ home }))).toEqual([]);
  refreshFlow(flow, lookup({ home }));
  expect(note).toEqual(before);
  const next = byId(flow, addNote(flow, "F1", "New"));
  expect(next.y).toBe(Number(image(flow, "F1").height) + 20);
});

test.each([
  [190, 0, false],
  [210, 0, true],
  [20, 60, false],
  [20, 61, true],
])("note gap %s and horizontal offset %s: far=%s", (gap, dx, far) => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const note = byId(flow, addNote(flow, "F1", "Note"));
  note.y = Number(image(flow, "F1").height) + Number(gap);
  note.x = Number(note.x) + Number(dx);
  expect(lintFlow(flow, lookup({ home })).some((f) => f.message.includes("px from"))).toBe(far);
});

test("lint skips far findings while the embed is stale", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const larger = { ...home, height: 500 };
  for (let i = 0; i < 3; i++) addNote(flow, "F1", `Note ${i}`);
  for (const e of flow.elements.filter((e) => identity(e)?.role === "note"))
    e.y = Number(e.y) + 300;
  expect(
    lintFlow(flow, lookup({ home: larger })).filter((f) => f.message.includes("px from")),
  ).toEqual([]);
  refreshFlow(flow, lookup({ home: larger }));
  expect(lintFlow(flow, lookup({ home: larger }))).toEqual([]);
});

test("retained notes precede displaced notes restored in vertical order", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: home });
  const notes = ["One", "Two", "Three", "Four"].map((text) =>
    byId(flow, addNote(flow, "F1", text)),
  );
  for (const e of [notes[0], notes[2]]) e.x = Number(e.x) + 900;
  const retained = [structuredClone(notes[1]), structuredClone(notes[3])];
  refreshFlow(flow, lookup({ home }));
  expect([notes[1], notes[3]]).toEqual(retained);
  expect(notes[0].y).toBe(Number(notes[3].y) + Number(notes[3].height) + 20);
  expect(notes[2].y).toBe(Number(notes[0].y) + Number(notes[0].height) + 20);
});

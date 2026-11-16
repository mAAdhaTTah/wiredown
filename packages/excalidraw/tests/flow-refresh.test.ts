import { expect, test } from "vitest";
import {
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  flowFrames,
  lintFlow,
  newFlow,
  overlayBox,
  parseFlow,
  refreshFlow,
  serializeFlow,
} from "../src/index.js";
import type { ExcalidrawElementJson, Flow, ScreenState } from "../src/index.js";
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
const lookup =
  (screens: Record<string, ScreenState>) =>
  (id: string): ScreenState | undefined =>
    screens[id];

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
  connect(flow, "F1", "F2", { label: "Go" });
  addNote(flow, "F1", "A note");
  const overlay = { target: "invite", box, screen: home };
  const hi = addHighlight(flow, "F1", overlay);
  const mark = addMark(flow, "F1", { ...overlay, label: "3" });
  return { flow, hi, mark };
}
const byId = (flow: Flow, id: string) => flow.elements.find((e) => e.id === id)!;
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
  const { flow, hi, mark } = build();
  const untouched = flow.elements
    .filter((e) => ![hi, mark, image(flow, "F1").id].includes(e.id) && e.containerId !== mark)
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
    { frame: "F1", kind: "highlight", element: hi, target: "invite" },
    { frame: "F1", kind: "mark", element: mark, target: "invite", label: "3" },
  ]);
  expect(img).toMatchObject({ x: 0, y: 0, width: 160, height: 265, version: version + 1 });
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
  const { flow, hi, mark } = build();
  const img = image(flow, "F1");
  Object.assign(img, { x: 50, y: 70, width: 60, height: 102.5 });
  const screens = lookup({ home, other });
  // the overlays were placed on the unscaled frame, so only they are stale
  expect(lintFlow(flow, screens).map((f) => f.element)).toEqual([hi, mark]);
  expect(refreshFlow(flow, screens).map((c) => c.kind)).toEqual(["highlight", "mark"]);
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
      message: "embeds ^other, which is not in the screens file or has errors",
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

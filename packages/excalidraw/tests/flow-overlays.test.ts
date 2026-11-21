import { DEFAULT_THEME, layoutScreen, parse, resolve } from "@wiredown/core";
import { expect, test } from "vitest";
import { markCentre } from "../src/flow-edit";
import {
  addDecision,
  addHighlight,
  addMark,
  addScreen,
  embedSize,
  flowFrames,
  newFlow,
  overlayBox,
  parseFlow,
  screenElements,
  serializeFlow,
} from "../src/index";
import type { ExcalidrawElementJson } from "../src/index";
import { bindingFailures, pluginFailures } from "./plugin-checks";

const screen = { width: 100, height: 200 };
const box = { x: 20, y: 30, w: 40, h: 50 };
test.each([
  [0, 0, 120, 205, 30, 30, 40, 50],
  [100, -20, 120, 205, 130, 10, 40, 50],
  [0, 0, 60, 102.5, 15, 15, 20, 25],
  [0, 0, 240, 410, 60, 60, 80, 100],
  [100, 10, 60, 410, 115, 70, 20, 100],
])("overlay geometry %j", (ix, iy, iw, ih, x, y, width, height) => {
  expect(
    overlayBox({ id: "image", type: "image", x: ix, y: iy, width: iw, height: ih }, screen, box),
  ).toEqual({ x, y, width, height });
});
test("overlays preserve existing elements, bind labels and survive serialization", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: screen });
  const image = flowFrames(flow)[0].element;
  image.x = 100;
  const [anchor, group] = [image.id, (image.groupIds as string[])[0]];
  const old = structuredClone(flow.elements);
  const options = { target: "invite", box, screen };
  const hi = addHighlight(flow, "F1", options);
  expect(flow.elements.find((e) => e.id === hi)).toMatchObject({
    x: 126,
    y: 26,
    width: 48,
    height: 58,
    strokeWidth: 2,
    strokeColor: DEFAULT_THEME.colors.highlight,
    backgroundColor: "transparent",
    customData: {
      wiredown: {
        role: "highlight",
        frame: "F1",
        screen: "home",
        target: "invite",
        anchor,
        id: hi,
      },
    },
    groupIds: [group],
  });
  const mark = addMark(flow, "F1", { ...options, label: "3" });
  const badge = flow.elements.find((e) => e.id === mark)!;
  // the badge sits up-left of the corner (130, 30), by a third of its diameter
  const d = Number(badge.width);
  expect(Number(badge.x) + d / 2).toBe(130 - d / 3);
  expect(Number(badge.y) + d / 2).toBe(30 - d / 3);
  expect(markCentre(130, 30, 32)).toEqual({ x: 130 - 32 / 3, y: 30 - 32 / 3 });
  for (const e of flow.elements.slice(-2)) {
    expect(e.groupIds).toEqual([group]);
    expect(e.customData).toEqual({
      wiredown: {
        v: 1,
        role: e.type === "text" ? "label" : "mark",
        frame: "F1",
        screen: "home",
        target: "invite",
        label: "3",
        anchor,
        id: e.id,
      },
    });
  }
  expect(flow.elements.at(-1)!.containerId).toBe(mark);
  expect(() => addHighlight(flow, "F1", options)).toThrow("F1 already highlights #invite");
  expect(() => addMark(flow, "F1", { ...options, label: "3" })).toThrow("already marks");
  addMark(flow, "F1", { ...options, label: "next" });
  expect(flow.elements.slice(0, old.length)).toEqual(old);
  addDecision(flow, { text: "Proceed?" });
  for (const fn of [
    addHighlight,
    (f: typeof flow, n: string, o: typeof options) => addMark(f, n, { ...o, label: "3" }),
  ]) {
    expect(() => fn(flow, "D1", options)).toThrow("decision, not a frame");
    expect(() => fn(flow, "F99", options)).toThrow("frames: F1");
  }
  const serialized = serializeFlow(flow);
  expect(pluginFailures(serialized)).toEqual([]);
  expect(bindingFailures(serialized)).toEqual([]);
  expect(serializeFlow(parseFlow(serialized))).toBe(serialized);
});

test("deleted overlays can be recreated and deleted frames are unknown", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: screen });
  const options = { target: "invite", box, screen };
  const first = addHighlight(flow, "F1", options);
  flow.elements.find((e) => e.id === first)!.isDeleted = true;
  expect(addHighlight(flow, "F1", options)).not.toBe(first);
  flowFrames(flow)[0].element.isDeleted = true;
  expect(() => addHighlight(flow, "F1", options)).toThrow('unknown frame "F1" (frames: none)');
});

const nested = [
  "window: Team #window",
  "  row: #row",
  "    text: Members #text",
  "    button: Invite #button",
  "  alert: Ready #alert",
  "  grid: #grid",
  "    Name | Role",
  "    Alice | Admin",
].join("\n");
test.each([1, 0.5, 2, "moved"] as const)("real screen bounds: %s", (scale) => {
  const base = parse(nested);
  const variant = resolve("extends: base\nreplace: text\n  text: Updated", {
    lookup: () => nested,
  });
  expect(base.errors).toEqual([]);
  expect(variant.errors).toEqual([]);
  for (const parsed of [base, variant]) {
    const padding = 8;
    const rendered = screenElements(layoutScreen(parsed.tree), { padding });
    const size = embedSize(rendered.width, rendered.height).image;
    const factor = scale === "moved" ? 1 : scale;
    const image = {
      id: "image",
      type: "image",
      x: scale === "moved" ? 321 : 0,
      y: scale === "moved" ? -79 : 0,
      width: size.width * factor,
      height: size.height * factor,
    };
    expect(Object.keys(rendered.boxes).sort()).toEqual(
      ["window", "row", "text", "button", "alert", "grid"].sort(),
    );
    for (const b of Object.values(rendered.boxes)) {
      const mapped = overlayBox(image, rendered, b);
      expect(mapped.x).toBeGreaterThanOrEqual(image.x);
      expect(mapped.y).toBeGreaterThanOrEqual(image.y);
      expect(mapped.x + mapped.width).toBeLessThanOrEqual(image.x + image.width);
      expect(mapped.y + mapped.height).toBeLessThanOrEqual(image.y + image.height);
    }
    const outer = overlayBox(image, rendered, rendered.boxes.window);
    expect(outer.x).toBe(image.x + ((10 + padding) * image.width) / size.width);
    expect(outer.y).toBe(image.y + (padding * image.height) / size.height);
  }
});

test("overlays find their frame by element id, not by name", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: screen });
  const options = { target: "invite", box, screen };
  addHighlight(flow, "F1", options);
  // a frame renamed by hand keeps its highlight
  const image = flowFrames(flow)[0].element;
  (image.customData as { wiredown: { frame: string } }).wiredown.frame = "F7";
  expect(() => addHighlight(flow, "F7", options)).toThrow("F7 already highlights #invite");
  // a person's pasted copy is not a frame; one pasted before elements
  // recorded their own id claims the name
  const copy: ExcalidrawElementJson = { ...structuredClone(image), id: "copy0001" };
  flow.elements.push(copy);
  expect(() => addHighlight(flow, "F7", options)).toThrow("F7 already highlights #invite");
  delete (copy.customData as { wiredown: { id?: string } }).wiredown.id;
  expect(() => addHighlight(flow, "F7", options)).toThrow(
    `F7 is claimed by elements ${image.id} and copy0001; remove the copy with "wiredown flow remove <flow> <id>"`,
  );
});

test("a person's copy of a highlight is not ours", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: screen });
  const options = { target: "invite", box, screen };
  addHighlight(flow, "F1", options);
  const original = flow.elements.at(-1)!;
  flow.elements.push({ ...structuredClone(original), id: "copy0001", strokeColor: "#ff0000" });
  original.isDeleted = true;
  const again = addHighlight(flow, "F1", options);
  expect(flow.elements.at(-1)!.customData).toMatchObject({ wiredown: { id: again } });
});

test("overlays on a frame inside a person's groups stay inside them", () => {
  const flow = newFlow();
  addScreen(flow, { screenId: "home", title: "Home", path: "screens", size: screen });
  const image = flowFrames(flow)[0].element;
  const chain = [(image.groupIds as string[])[0], "human"];
  for (const e of flow.elements) e.groupIds = chain;
  const before = structuredClone(flow.elements);
  const options = { target: "invite", box, screen };
  addHighlight(flow, "F1", options);
  addMark(flow, "F1", { ...options, label: "1" });
  expect(flow.elements.slice(before.length).map((e) => e.groupIds)).toEqual([chain, chain, chain]);
  expect(flow.elements.slice(0, before.length)).toEqual(before);
});

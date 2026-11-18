import { EXCALIFONT, FONT_SIZE, layoutScreen, LIGHT_INK, parse } from "@wiredown/core";
import type { DrawOp, LayoutResult } from "@wiredown/core";
import { describe, expect, it } from "vitest";
import { EXCALIFONT_FAMILY, sceneOf, screenElements } from "../src/index.js";

const SPEC = [
  "window: Team #win",
  "  text: Members",
  "  button: *Invite #invite",
  "  radio: *Owner",
  "  checkbox: [x] Admin",
  "  link: [Help]",
].join("\n");

const screen = () => layoutScreen(parse(SPEC).tree);
const opsOnly = (ops: DrawOp[]): LayoutResult => ({ ops, size: { w: 0, h: 0 }, boxes: {} });

describe("screenElements", () => {
  it("is the same every time, with stable ids and seeds", () => {
    const a = screenElements(screen());
    expect(screenElements(screen())).toEqual(a);
    expect(a.elements.map((e) => e.id)).toEqual(a.elements.map((_, i) => `wf-${i}`));
    expect(new Set(a.elements.map((e) => e.seed)).size).toBe(a.elements.length);
  });

  it("prefixes ids so several screens can share a scene", () => {
    const ids = screenElements(screen(), { idPrefix: "team" }).elements.map((e) => e.id);
    expect(ids.every((id) => id.startsWith("team-"))).toBe(true);
  });

  it("maps every op kind to an Excalidraw element", () => {
    const types = new Set(screenElements(screen()).elements.map((e) => e.type));
    expect([...types].sort()).toEqual(["ellipse", "line", "rectangle", "text"]);
  });

  it("writes text in Excalifont at the line height layout measured with", () => {
    const text = screenElements(screen()).elements.find((e) => e.text === "Members");
    expect(text).toMatchObject({
      fontFamily: EXCALIFONT_FAMILY,
      fontSize: FONT_SIZE,
      lineHeight: EXCALIFONT.lineHeight,
      strokeColor: LIGHT_INK,
    });
    expect(text!.height).toBe(FONT_SIZE * EXCALIFONT.lineHeight);
  });

  it("frames the drawing with padding, so the export is layout's box plus padding", () => {
    const ops: DrawOp[] = [
      {
        kind: "rect",
        x: 0,
        y: 0,
        w: 100.5,
        h: 40,
        fill: null,
        stroke: true,
        strokeWidth: 1,
        rounded: false,
      },
    ];
    const { elements, width, height } = screenElements(opsOnly(ops), { padding: 10 });
    expect({ width, height }).toEqual({ width: 121, height: 60 });
    expect(elements[0]).toMatchObject({
      type: "rectangle",
      x: -10,
      y: -10,
      width: 121,
      height: 60,
      strokeColor: "transparent",
      roughness: 0,
    });
  });

  it("uses the prototype's defaults: padding 8, roughness 1", () => {
    const { width, elements } = screenElements(screen());
    const size = screen().size;
    expect(width).toBe(Math.ceil(size.w + 16));
    expect(elements[1].roughness).toBe(1);
    expect(screenElements(screen(), { roughness: 0 }).elements[1].roughness).toBe(0);
  });

  it("paints fills, ink fills, rounded and dashed boxes, and coloured lines", () => {
    const ops: DrawOp[] = [
      {
        kind: "rect",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        fill: "#abcdef",
        stroke: false,
        strokeWidth: 2,
        rounded: true,
        dashed: true,
      },
      { kind: "ellipse", x: 0, y: 0, w: 4, h: 4, fill: "ink", stroke: true, strokeWidth: 1 },
      {
        kind: "line",
        points: [
          [5, 5],
          [15, 2],
          [10, 20],
        ],
        strokeWidth: 1,
        color: "#ff0000",
      },
      { kind: "line", points: [[1, 1]], strokeWidth: 1 },
    ];
    const [, rect, ellipse, line, ...rest] = screenElements(opsOnly(ops)).elements;
    expect(rest).toEqual([]);
    expect(rect).toMatchObject({
      backgroundColor: "#abcdef",
      strokeColor: "transparent",
      strokeWidth: 2,
      roundness: { type: 3, value: 8 },
      strokeStyle: "dashed",
    });
    expect(ellipse).toMatchObject({ backgroundColor: LIGHT_INK, strokeColor: LIGHT_INK });
    expect(line).toMatchObject({
      x: 5,
      y: 5,
      width: 10,
      height: 18,
      strokeColor: "#ff0000",
      points: [
        [0, 0],
        [10, -3],
        [5, 15],
      ],
    });
  });

  it("returns nothing for an empty screen", () => {
    expect(screenElements(opsOnly([]))).toEqual({ elements: [], width: 0, height: 0, boxes: {} });
  });

  it("moves #id boxes into the export's coordinates, onto their drawn element", () => {
    const layout = screen();
    for (const padding of [8, 20]) {
      const { elements, boxes } = screenElements(layout, { padding });
      const frame = elements[0] as unknown as { x: number; y: number };
      expect(Object.keys(boxes).sort()).toEqual(["invite", "win"]);
      // the window's box starts at the image's top-left, inside the padding
      expect(boxes.win).toMatchObject({ x: padding, y: padding });
      // the button's box is exactly the rectangle drawn for it, shifted by the frame
      const b = boxes.invite;
      const drawn = {
        type: "rectangle",
        x: b.x + frame.x,
        y: b.y + frame.y,
        width: b.w,
        height: b.h,
      };
      expect(elements).toContainEqual(expect.objectContaining(drawn));
    }
  });

  it("keeps boxes inside the export when the drawing reaches past the origin", () => {
    const ops: DrawOp[] = [
      {
        kind: "rect",
        x: -4,
        y: -6,
        w: 50,
        h: 30,
        fill: null,
        stroke: true,
        strokeWidth: 1,
        rounded: false,
      },
    ];
    const layout = { ...opsOnly(ops), boxes: { a: { x: 0, y: 0, w: 42, h: 18 } } };
    expect(screenElements(layout, { padding: 8 }).boxes.a).toEqual({ x: 12, y: 14, w: 42, h: 18 });
  });
});

describe("sceneOf", () => {
  it("wraps elements in the scene Excalidraw's exporters take", () => {
    const { elements } = screenElements(screen());
    expect(sceneOf(elements)).toEqual({
      type: "excalidraw",
      version: 2,
      source: "wiredown",
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
  });
});

it("fills a dot in a disabled component with the disabled colour", () => {
  const { elements } = screenElements(layoutScreen(parse("icon: dot (disabled)").tree));
  const dot = elements.find((e) => e.type === "ellipse");
  expect(dot).toMatchObject({ backgroundColor: "#adb5bd" });
});

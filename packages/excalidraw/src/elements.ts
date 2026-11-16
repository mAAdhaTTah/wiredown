import { EXCALIFONT, FONT_SIZE, INK, LIGHT_INK } from "@wiredown/core";
import type { Box, DrawOp, LayoutResult } from "@wiredown/core";

// Turns layout ops into plain Excalidraw element JSON, with no Excalidraw
// code involved, so one adapter feeds every host: the Obsidian plugin hands
// the elements to the Excalidraw plugin's exporter, Node and a browser
// script hand them to Excalidraw's own exporter. Excalidraw then draws
// them, so the strokes, font and dark mode are Excalidraw's own. Elements
// are always for the light theme; Excalidraw darkens them at export.

/** Excalidraw's font family number for Excalifont. */
export const EXCALIFONT_FAMILY = 5;
/** Largest corner radius of a rounded box (Excalidraw's own default is 32). */
const CORNER = 8;

export interface ElementOptions {
  /** 0 architect, 1 artist, 2 cartoonist. */
  roughness?: number;
  /** Space kept around the drawing; the invisible frame element is this much larger. */
  padding?: number;
  /** Prefix of element ids; ids are stable, so two renders of a screen are identical. */
  idPrefix?: string;
}

export type ExcalidrawElementJson = Record<string, unknown> & { id: string; type: string };

export interface ScreenElements {
  /** Light-theme elements; Excalidraw's own dark mode is applied at export. */
  elements: ExcalidrawElementJson[];
  /** Size of the export: the drawing plus padding, in whole px. */
  width: number;
  height: number;
  /** Layout's box for each #id, in the export's coordinates (0,0 is its top-left). */
  boxes: Record<string, Box>;
}

// The seed decides Rough.js's wobble. It comes from the op's position in
// the list, so a screen is drawn the same way every time and everywhere.
function seedOf(i: number): number {
  let h = (i + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 2147483646) + 1;
}

/** A laid-out screen as Excalidraw elements, with its #id boxes moved to match. */
export function screenElements(layout: LayoutResult, options: ElementOptions = {}): ScreenElements {
  const { elements, width, height, x, y } = opsToElements(layout.ops, options);
  if (!elements.length) return { elements, width, height, boxes: {} };
  const boxes: Record<string, Box> = {};
  for (const [id, b] of Object.entries(layout.boxes)) boxes[id] = { ...b, x: b.x - x, y: b.y - y };
  return { elements, width, height, boxes };
}

function opsToElements(
  ops: DrawOp[],
  o: ElementOptions,
): { elements: ExcalidrawElementJson[]; width: number; height: number; x: number; y: number } {
  const ink = LIGHT_INK;
  const pad = o.padding ?? 8;
  const roughness = o.roughness ?? 1;
  const prefix = o.idPrefix ?? "wf";
  const elements: ExcalidrawElementJson[] = [];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const base = (
    type: string,
    x: number,
    y: number,
    width: number,
    height: number,
    over: Record<string, unknown>,
  ) => {
    const i = elements.length;
    elements.push({
      id: `${prefix}-${i}`,
      type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: ink,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: null,
      roundness: null,
      seed: seedOf(i),
      version: 1,
      versionNonce: seedOf(i + 7919),
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      ...over,
    });
  };
  // slot 0 is the frame; it is filled in once the bounds are known
  base("rectangle", 0, 0, 0, 0, { strokeColor: "transparent", roughness: 0 });

  for (const op of ops) {
    switch (op.kind) {
      case "rect":
      case "ellipse": {
        grow(op.x, op.y);
        grow(op.x + op.w, op.y + op.h);
        base(op.kind === "rect" ? "rectangle" : "ellipse", op.x, op.y, op.w, op.h, {
          strokeColor: op.stroke ? (op.color ?? ink) : "transparent",
          backgroundColor: op.fill === INK ? (op.color ?? ink) : (op.fill ?? "transparent"),
          strokeWidth: op.strokeWidth,
          ...(op.kind === "rect" && op.rounded ? { roundness: { type: 3, value: CORNER } } : {}),
          ...(op.kind === "rect" && op.dashed ? { strokeStyle: "dashed" } : {}),
        });
        break;
      }
      case "line": {
        if (op.points.length < 2) break;
        const [ox, oy] = op.points[0];
        const xs = op.points.map((p) => p[0]),
          ys = op.points.map((p) => p[1]);
        op.points.forEach((p) => grow(p[0], p[1]));
        base("line", ox, oy, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
          strokeWidth: op.strokeWidth,
          ...(op.color ? { strokeColor: op.color } : {}),
          points: op.points.map((p) => [p[0] - ox, p[1] - oy]),
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
          polygon: false,
        });
        break;
      }
      case "text": {
        grow(op.x, op.y);
        grow(op.x + op.w, op.y + op.h);
        base("text", op.x, op.y, op.w, op.h, {
          ...(op.color ? { strokeColor: op.color } : {}),
          text: op.text,
          originalText: op.text,
          rawText: op.text,
          fontSize: op.fontSize ?? FONT_SIZE,
          fontFamily: EXCALIFONT_FAMILY,
          textAlign: "left",
          verticalAlign: "top",
          containerId: null,
          autoResize: true,
          // the line height layoutScreen measured with
          lineHeight: EXCALIFONT.lineHeight,
        });
        break;
      }
    }
  }
  if (elements.length === 1) return { elements: [], width: 0, height: 0, x: 0, y: 0 };
  // The frame makes the export's bounding box exactly layout's box plus
  // padding. Without it the exporter measures the rough strokes, and the
  // image would be a pixel or two off the size a flow reserves for it.
  const width = Math.ceil(x1 - x0 + 2 * pad),
    height = Math.ceil(y1 - y0 + 2 * pad);
  const x = x0 - pad,
    y = y0 - pad;
  Object.assign(elements[0], { x, y, width, height });
  return { elements, width, height, x, y };
}

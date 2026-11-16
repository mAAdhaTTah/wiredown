import type { Component } from "../types.js";
import { drawLabel, measureLabel } from "./label.js";
import { contentLines } from "./shared.js";

// Excalidraw text has no bold, so headings stand out by size alone.
const SCALE = { h1: 1.75, h2: 1.375 };

/** h1 (also "heading") and h2: one line of larger text, icons allowed. */
export const heading: Component = (ctx, node, x, y, slot) => {
  const fontSize = Math.round(ctx.fontSize * (node.type === "h2" ? SCALE.h2 : SCALE.h1));
  const label = measureLabel(ctx, contentLines(node).join(" ") || "Heading", fontSize);
  drawLabel(ctx, x, y, label, { fontSize });
  return { w: Math.max(label.w, slot?.w || 0), h: label.h };
};

import type { Component } from "../types.js";
import { drawLabel, isRich, measureLabel, wrapLabel } from "./label.js";
import { contentLines } from "./shared.js";

export const text: Component = (ctx, node, x, y, slot) => {
  const str = contentLines(node).join("\n") || "Text";
  let w: number, h: number;
  const room = ctx.maxW === undefined ? undefined : slot?.w || ctx.maxW;
  const tooWide = room !== undefined && ctx.measure(str).w > room;
  if (isRich(str) || tooWide) {
    // one label per line, so each line can mix icons, links and text
    const labels = str
      .split("\n")
      .flatMap((line) => (tooWide ? wrapLabel(ctx, line, room) : [measureLabel(ctx, line)]));
    h = 0;
    for (const label of labels) {
      drawLabel(ctx, x, y + h, label);
      h += label.h;
    }
    w = Math.max(...labels.map((l) => l.w));
  } else {
    const m = ctx.measure(str);
    ctx.text(x, y, str, m);
    ({ w, h } = m);
  }
  // stretched text stays left-aligned and takes up the room it was given
  return { w: Math.max(w, slot?.w || 0), h };
};

import { drawIcon, isIcon } from "../icons.js";
import type { Component } from "../types.js";
import { iconSizeFor } from "./label.js";

export const icon: Component = (ctx, node, x, y) => {
  const name = node.text.trim();
  const s = node.opts.w || iconSizeFor(ctx);
  if (isIcon(name)) {
    drawIcon(ctx, name, x, y, s);
  } else {
    // unknown name (the parser reports it): a crossed placeholder
    ctx.rect(x, y, s, s);
    ctx.line([
      [x, y],
      [x + s, y + s],
    ]);
  }
  return { w: s, h: s };
};

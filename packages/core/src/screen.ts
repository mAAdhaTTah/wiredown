import { layout } from "./layout.js";
import type { LayoutResult } from "./layout.js";
import { fontMeasurer } from "./metrics.js";
import { EXCALIFONT } from "./metrics-excalifont.js";
import { FONT_SIZE } from "./theme.js";
import type { SpecNode, Theme } from "./types.js";

export interface LayoutScreenOptions {
  maxWidth?: number;
  theme?: Theme;
}

const { measure } = fontMeasurer(EXCALIFONT);

/** The shared layout defaults for every surface that draws a screen. */
export function layoutScreen(tree: SpecNode, options: LayoutScreenOptions = {}): LayoutResult {
  return layout(
    tree,
    { x: 0, y: 0 },
    {
      measure,
      style: { fontSize: FONT_SIZE, fontFamily: 5 },
      ...options,
    },
  );
}

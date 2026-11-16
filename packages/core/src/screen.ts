import { layout } from "./layout";
import type { LayoutResult } from "./layout";
import { EXCALIFONT } from "./metrics-excalifont";
import { fontMeasurer } from "./metrics";
import { FONT_SIZE } from "./theme";
import type { SpecNode, Theme } from "./types";

export const EXCALIFONT_FAMILY = 5;

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
      style: { fontSize: FONT_SIZE, fontFamily: EXCALIFONT_FAMILY },
      ...options,
    },
  );
}

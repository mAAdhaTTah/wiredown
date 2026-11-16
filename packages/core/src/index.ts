export { FENCE_KEYWORD, extractSpec, fenceSpec, specAtLine } from "./detect.js";
export { formatError, nearest, parse, parseOptions } from "./parse.js";
export { CATALOG, COMMON_FLAGS, catalogEntry, optionsOf } from "./catalog.js";
export type { CatalogEntry } from "./catalog.js";
export { extendsId, resolve, serialize } from "./variants.js";
export type { Lookup, ResolveOptions } from "./variants.js";
export {
  ASCENT,
  DESCENT,
  FONT_CSS,
  FONT_STACK,
  LINE_HEIGHT,
  tableMeasure,
  unmeasured,
  fontMeasurer,
} from "./metrics";
export type { FontMetrics } from "./metrics";
export { layout } from "./layout";
export type { LayoutEnv } from "./layout";
export { DARK_COLORS, DARK_INK, DEFAULT_THEME, FONT_SIZE, INK, LIGHT_INK } from "./theme";
export { ICON_NAMES, isIcon } from "./icons";
export type * from "./types";

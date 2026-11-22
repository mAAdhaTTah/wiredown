import type { Theme } from "./types";

export const FONT_SIZE = 16;

export const DEFAULT_THEME: Theme = {
  colors: {
    fill: "#e9ecef", // neutral component fill
    primary: "#a5d8ff", // primary button
    selected: "#d0ebff", // selected grid row
    paper: "#ffffff", // inside of inputs and checkboxes
    disabled: "#adb5bd", // stroke and text of (disabled) components
    muted: "#868e96", // secondary text
    dark: "#343a40", // background of (dark) panels
    onDark: "#f8f9fa", // text and lines on (dark) panels
    stripe: "#f1f3f5", // every other row of a (striped) grid
    link: "#1971c2", // [links] in labels and link:
    error: "#e03131", // (required) and (invalid) marks
    highlight: "#f76707", // the (focus) outline
  },
  gap: { root: 24, stack: 14, row: 12, pad: 16 },
};

/** A fill that means "the stroke colour", for solid dots and icons. */
export const INK = "ink";

/** The same colours for a dark page. */
export const DARK_COLORS: Theme["colors"] = {
  fill: "#3b4046",
  primary: "#1c5a8f",
  selected: "#1d3b57",
  paper: "#1e1e1e",
  disabled: "#6c757d",
  muted: "#9aa1a8",
  dark: "#0f1012",
  onDark: "#f8f9fa",
  stripe: "#26292d",
  link: "#74b9ff",
  error: "#ff6b6b",
  highlight: "#ffa94d",
};
/** Ink (strokes and text) for a light and a dark page. */
export const LIGHT_INK = "#1e1e1e";
export const DARK_INK = "#dadada";

import { ADVANCE_RUNS, FALLBACK_ADVANCE, UNITS_PER_EM } from "./metrics-arimo.js";
import type { MeasureText } from "./types.js";

// One text measurer for every host (Node, Obsidian, a browser script): a
// table of advance widths, so no canvas and no font file is needed to lay
// out. It is exact only if the text is then drawn in a font with the same
// advances and without kerning or ligatures, which FONT_CSS asks for.

/** Fonts that share the table's advances; the first one installed is used. */
export const FONT_STACK = "Arimo, 'Liberation Sans', Arial, Helvetica, sans-serif";
/** Turns off kerning and ligatures, which the table doesn't model. */
export const FONT_CSS = "font-kerning:none;font-variant-ligatures:none;letter-spacing:0;word-spacing:0";
export const LINE_HEIGHT = 1.25;
/** Arimo's ascent and descent, in em; they place the baseline within a line. */
export const ASCENT = 1854 / UNITS_PER_EM;
export const DESCENT = 434 / UNITS_PER_EM;

const ADVANCES = new Map<number, number>();
for (const [first, ...widths] of ADVANCE_RUNS) widths.forEach((w, i) => ADVANCES.set(first + i, w));

function lineWidth(line: string): number {
  let units = 0;
  for (const ch of line) units += ADVANCES.get(ch.codePointAt(0)!) ?? FALLBACK_ADVANCE;
  return units;
}

export const tableMeasure: MeasureText = (text, style) => {
  const lines = text.split("\n");
  return {
    w: (Math.max(...lines.map(lineWidth)) * style.fontSize) / UNITS_PER_EM,
    h: lines.length * style.fontSize * LINE_HEIGHT,
  };
};

/** Characters the table has no width for; a fallback font draws them at an unknown width. */
export function unmeasured(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && !ADVANCES.has(cp)) out.add(ch);
  }
  return [...out];
}

/** A font as layout needs it: advance widths, vertical metrics and the host's line height. */
export interface FontMetrics {
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  fallbackAdvance: number;
  /** Runs of consecutive code points: [first code point, advance, advance, ...]. */
  runs: number[][];
  /** Kerning by character pair, in font units; browsers apply it, so the table must too. */
  kerning?: Record<string, number>;
}

/** A table measurer for any font, plus the characters its table lacks. */
export function fontMeasurer(font: FontMetrics): {
  measure: MeasureText;
  unmeasured(text: string): string[];
} {
  const advances = new Map<number, number>();
  for (const [first, ...widths] of font.runs) widths.forEach((w, i) => advances.set(first + i, w));
  const width = (line: string) => {
    let units = 0,
      prev = "";
    for (const ch of line) {
      units += advances.get(ch.codePointAt(0)!) ?? font.fallbackAdvance;
      if (font.kerning && prev) units += font.kerning[prev + ch] ?? 0;
      prev = ch;
    }
    return units;
  };
  return {
    measure: (text, style) => {
      const lines = text.split("\n");
      return {
        w: (Math.max(...lines.map(width)) * style.fontSize) / font.unitsPerEm,
        h: lines.length * style.fontSize * font.lineHeight,
      };
    },
    unmeasured: (text) => {
      const out = new Set<string>();
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0x20 && !advances.has(cp)) out.add(ch);
      }
      return [...out];
    },
  };
}

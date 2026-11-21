import type { MeasureText } from "./types";

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

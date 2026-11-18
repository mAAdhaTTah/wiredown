import { describe, expect, it } from "vitest";
import { labelAtoms } from "../src/components/label.js";
import { layout } from "../src/layout.js";
import { parse } from "../src/parse.js";
import { FONT_SIZE } from "../src/theme.js";
import type { LineOp, TextOp } from "../src/types.js";
import { CHAR_W, fakeMeasure, LINE_H } from "./helpers/fakeMeasure.js";

const style = { fontSize: FONT_SIZE, fontFamily: 5 };
const draw = (source: string, maxWidth?: number) =>
  layout(parse(source).tree, { x: 0, y: 0 }, { measure: fakeMeasure, style, maxWidth });
const texts = (source: string, maxWidth?: number) =>
  draw(source, maxWidth).ops.filter((o): o is TextOp => o.kind === "text");

const TABLE = [
  "grid",
  "[x] | Board | Candidates (freq % · EV) | Status",
  "[x] | 2c3c4c | 33% 41·3.59  75% 22·3.55 | -Stale- [re-run now]",
].join("\n");

describe("label atoms", () => {
  it("breaks between words and keeps each word's markup", () => {
    expect(labelAtoms("{warning} Two words [re-run now] -grey text- end")).toEqual([
      "{warning}",
      "Two",
      "words",
      "[re-run]",
      "[now]",
      "-grey-",
      "-text-",
      "end",
    ]);
  });
});

describe("grids that wrap", () => {
  it("lays a grid out as before when there is no width to wrap to", () => {
    expect(draw(TABLE, undefined)).toEqual(draw(TABLE, 100000));
  });

  it("is no wider than the room, and taller for it", () => {
    const wide = draw(TABLE);
    const narrow = draw(TABLE, 400);
    expect(wide.size.w).toBeGreaterThan(400);
    expect(narrow.size.w).toBeLessThanOrEqual(400);
    expect(narrow.size.h).toBeGreaterThan(wide.size.h);
  });

  it("keeps every word, each inside its column", () => {
    const { ops } = draw(TABLE, 400);
    const words = (os: TextOp[]) => os.flatMap((o) => o.text.split(/\s+/)).sort();
    const all = ops.filter((o): o is TextOp => o.kind === "text");
    expect(words(all)).toEqual(words(texts(TABLE)));
    // column lines run the grid's full height; a text never crosses the next one
    const xs = ops
      .filter((o): o is LineOp => o.kind === "line" && o.points[0][0] === o.points[1][0])
      .map((o) => o.points[0][0])
      .sort((a, b) => a - b);
    for (const t of all) {
      const next = xs.find((x) => x > t.x) ?? 400;
      expect(t.x + t.w).toBeLessThanOrEqual(next);
    }
  });

  it("never makes a column narrower than its longest word", () => {
    const { size } = draw("grid\nSupercalifragilistic, b\n1, 2", 50);
    expect(size.w).toBeGreaterThanOrEqual("Supercalifragilistic".length * CHAR_W);
  });

  it("wraps the label of a checkbox cell beside its box", () => {
    const lines = texts("grid\nPick, Name\n[x] one two three four five six, a", 160).filter((t) =>
      /one|six/.test(t.text),
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(new Set(lines.map((t) => t.x)).size).toBe(1);
  });

  it("takes the width of a frame that has one", () => {
    const framed = draw(`window: T (w=420)\n  ${TABLE.split("\n").join("\n  ")}`, 2000);
    expect(framed.size.w).toBe(420);
    const explicit = draw(
      `window: T (w=420)\n  ${TABLE.replace("grid", "grid (fill)").split("\n").join("\n  ")}`,
      2000,
    );
    expect(framed).toEqual(explicit);
    expect(framed.ops.filter((o) => o.kind === "text").length).toBeGreaterThan(texts(TABLE).length);
  });
});

describe("alerts and text that wrap", () => {
  it("wraps an alert to the room", () => {
    const long = "alert: {warning} one two three four five six seven eight nine ten";
    expect(draw(long).size.h).toBeLessThan(draw(long, 200).size.h);
    expect(draw(long, 200).size.w).toBeLessThanOrEqual(200);
  });

  it("wraps text to the room, a line per LINE_H", () => {
    const { size } = draw("text: one two three four five six seven eight nine ten", 100);
    expect(size.w).toBeLessThanOrEqual(100);
    expect(size.h % LINE_H).toBe(0);
    expect(size.h).toBeGreaterThan(LINE_H);
  });
});

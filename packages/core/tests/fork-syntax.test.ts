import { describe, expect, it } from "vitest";
import { layout } from "../src/layout.js";
import { parse } from "../src/parse.js";
import { DEFAULT_THEME, FONT_SIZE } from "../src/theme.js";
import type { RectOp } from "../src/types.js";
import { fakeMeasure } from "./helpers/fakeMeasure.js";

const style = { fontSize: FONT_SIZE, fontFamily: 5 };
const draw = (source: string) =>
  layout(parse(source).tree, { x: 0, y: 0 }, { measure: fakeMeasure, style });
const outlines = (source: string) =>
  draw(source).ops.filter(
    (o): o is RectOp => o.kind === "rect" && o.color === DEFAULT_THEME.colors.highlight,
  );

describe("comments", () => {
  it("skips lines that start with //", () => {
    const { tree, errors } = parse("// the footer\nbutton: Save\n  // not a child\nbutton: Cancel");
    expect(errors).toEqual([]);
    expect(tree.children.map((c) => c.text)).toEqual(["Save", "Cancel"]);
  });

  it("keeps a comment out of a grid's rows", () => {
    const grid = parse("grid\na, b\n// hidden\n1, 2").tree.children[0];
    expect(grid.body).toEqual(["a, b", "1, 2"]);
  });
});

describe("highlight", () => {
  it("keeps the former (hi) flag as literal text", () => {
    const { tree, errors } = parse("button: Save (hi)");
    expect(errors).toEqual([]);
    expect(tree.children[0].text).toBe("Save (hi)");
    expect(tree.children[0].opts).toEqual({});
    expect(outlines("button: Save (hi)")).toHaveLength(0);
  });

  it("outlines any component marked (focus), without moving the layout", () => {
    for (const line of [
      "button: Apply",
      "text: Hello",
      "alert: Careful",
      "dropdown: A | B",
      "grid\na, b",
    ]) {
      const [head, ...rest] = line.split("\n");
      const marked = [`${head} (focus)`, ...rest].join("\n");
      expect(outlines(marked)).toHaveLength(1);
      expect(draw(marked).size).toEqual(draw(line).size);
    }
  });

  it("is separate from a primary button's star", () => {
    expect(outlines("button: *Apply")).toHaveLength(0);
    const fills = (s: string) =>
      draw(s).ops.filter((o) => o.kind === "rect" && o.fill === DEFAULT_THEME.colors.primary);
    expect(fills("button: Cancel (focus)")).toHaveLength(0);
    expect(fills("button: *Apply (focus)")).toHaveLength(1);
  });

  it("outlines a grid row marked >, which may also be selected", () => {
    expect(outlines("grid\na, b\n> 1, 2\n3, 4")).toHaveLength(1);
    const ops = draw("grid\na, b\n>* 1, 2").ops;
    expect(ops.some((o) => o.kind === "rect" && o.fill === DEFAULT_THEME.colors.selected)).toBe(
      true,
    );
  });
});

describe("errors for likely typos", () => {
  it("suggests the component a misspelt keyword was meant to be", () => {
    const { errors } = parse("box: A\n  button: Go\n  buton: Stop");
    expect(errors).toEqual([
      { line: 3, message: 'unknown component "buton"; did you mean "button"?' },
    ]);
  });

  it("still takes other text with a colon as a continuation line", () => {
    const { errors, tree } = parse("paragraph: First\nNote: second line");
    expect(errors).toEqual([]);
    expect(tree.children[0].body).toEqual(["Note: second line"]);
  });

  it("reports an unknown flag next to a k=v pair, and a pair that isn't a number", () => {
    const { errors } = parse("button: Go (w=120, disbled)\ngrid (w=wide)\na, b");
    expect(errors).toEqual([
      { line: 1, message: 'unknown option "disbled"; did you mean "disabled"?' },
      { line: 2, message: 'option "w=wide" needs a number, as in "w=200"' },
    ]);
  });

  it("reports a misspelt flag that stands alone, but leaves other brackets as text", () => {
    expect(parse("button: Apply (disbled)").errors).toEqual([
      { line: 1, message: 'unknown option "disbled"; did you mean "disabled"?' },
    ]);
    const { tree, errors } = parse("box: Title (optional)");
    expect(errors).toEqual([]);
    expect(tree.children[0].text).toBe("Title (optional)");
  });

  it("reports an option no component reads", () => {
    expect(parse("button: Go (width=120)").errors).toEqual([
      { line: 1, message: 'unknown option "width"' },
    ]);
  });
});

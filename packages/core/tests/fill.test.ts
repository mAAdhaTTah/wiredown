import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, FONT_SIZE, layout, parse, resolve } from "../src/index";
import type { DrawOp, LineOp, RectOp, Style, TextOp } from "../src/index";
import { fakeMeasure } from "./helpers/fakeMeasure";

const style: Style = { stroke: "#1e1e1e", fontFamily: 5, roughness: 1, fontSize: FONT_SIZE };
const draw = (source: string) =>
  layout(parse(source).tree, { x: 0, y: 0 }, { measure: fakeMeasure, style });
const rects = (ops: DrawOp[]) => ops.filter((o): o is RectOp => o.kind === "rect");
const texts = (ops: DrawOp[]) => ops.filter((o): o is TextOp => o.kind === "text");
const lines = (ops: DrawOp[]) => ops.filter((o): o is LineOp => o.kind === "line");
const { pad, row: rowGap } = DEFAULT_THEME.gap;

describe("(fill) in a stack", () => {
  it("makes a button as wide as the widest sibling", () => {
    const { ops } = draw("dropdown: A very long option indeed\nbutton: OK (fill)");
    const [dropdown, button] = rects(ops);
    expect(button.w).toBe(dropdown.w);
  });

  it("makes a button as wide as the inside of its box", () => {
    const { ops } = draw("box: Panel (w=400)\n  text: Hello\n  button: *Save (fill)");
    const frame = rects(ops).find((r) => r.strokeWidth === 2 && !r.rounded)!;
    const button = rects(ops).find((r) => r.rounded)!;
    expect(frame.w).toBe(400);
    expect(button.w).toBe(400 - 2 * pad);
    expect(button.x).toBe(pad);
  });

  it("stretches inside tabs", () => {
    const { ops } = draw("tabs: A | B (w=500)\n  button: Go (fill)");
    const button = rects(ops).find((r) => r.rounded)!;
    expect(button.w).toBe(500 - 2 * pad);
  });

  it("stretches a grid by sharing the extra width between its columns", () => {
    const natural = draw("grid\na, b");
    const { ops } = draw("box (w=600)\n  grid (fill)\n  a, b");
    const frame = rects(ops).find((r) => r.strokeWidth === 2 && r.w !== 600)!;
    expect(frame.w).toBe(600 - 2 * pad);
    const divider = lines(ops).find((l) => l.points[0][0] === l.points[1][0])!;
    const naturalCol = rects(natural.ops)[0].w / 2;
    expect(divider.points[0][0] - frame.x).toBe(naturalCol + (600 - 2 * pad - 2 * naturalCol) / 2);
  });

  it("does nothing without (fill)", () => {
    const { ops } = draw("box: Panel (w=400)\n  button: Save");
    expect(rects(ops).find((r) => r.rounded)!.w).toBe(80);
  });
});

describe("(fill) in a row", () => {
  it("shares the row's width between fill children", () => {
    const { ops, size } = draw("row: (w=500)\n  button: Back\n  text: Title (fill)\n  button: X");
    expect(size.w).toBe(500);
    const [back, x] = rects(ops);
    expect(x.x + x.w).toBe(500);
    expect(back.x).toBe(0);
  });

  it("takes the width from a box when the row itself is (fill)", () => {
    const { ops } = draw("box (w=400)\n  row: (fill)\n    text: Users (fill)\n    button: Close");
    const close = rects(ops).find((r) => r.rounded)!;
    expect(close.x + close.w).toBe(400 - pad);
  });

  it("splits evenly between several fill children", () => {
    const { ops } = draw("row: (w=500)\n  button: A (fill)\n  button: B (fill)");
    const [a, b] = rects(ops);
    expect(a.w).toBe((500 - rowGap) / 2);
    expect(b.w).toBe(a.w);
  });

  it("keeps natural sizes when there is no width to share", () => {
    const { ops } = draw("row:\n  button: A (fill)\n  button: B");
    expect(rects(ops).map((r) => r.w)).toEqual([80, 80]);
  });

  it("is as wide as its (w=...) without fill children [M6]", () => {
    expect(draw("row: (w=700)\n  button: A").size.w).toBe(700);
  });

  it("takes its share as a fill child of another row [M6]", () => {
    const { ops } = draw("row: (w=500)\n  button: A\n  row: (fill)\n    text: B\n  button: C");
    const c = rects(ops)[1];
    expect(c.x + c.w).toBe(500);
  });

  it("works as a spacer when empty and (fill) [M6]", () => {
    const { ops } = draw(
      "box (w=400)\n  row: (fill)\n    button: Left\n    row: (fill)\n    button: Right",
    );
    const [left, right] = rects(ops).filter((r) => r.rounded);
    expect(left.x).toBe(pad);
    expect(right.x + right.w).toBe(400 - pad);
    expect(texts(ops).map((t) => t.text)).toEqual(["Left", "Right"]);
  });
});

describe("(disabled)", () => {
  const grey = DEFAULT_THEME.colors.disabled;

  it("greys out the strokes and text of a component", () => {
    const { ops } = draw("button: Save (disabled)");
    expect(rects(ops)[0].color).toBe(grey);
    expect(texts(ops)[0].color).toBe(grey);
  });

  it("applies to everything inside a disabled container, and nothing after it", () => {
    const { ops } = draw("box: A (disabled)\n  dropdown: x\nbutton: B");
    const coloured = ops.filter((o) => "color" in o).length;
    expect(coloured).toBe(ops.length - 2); // the button's rect and text
    expect(texts(ops)[texts(ops).length - 1]).not.toHaveProperty("color");
  });

  it("leaves ops of normal components without a color key", () => {
    for (const op of draw("button: Save").ops) expect(op).not.toHaveProperty("color");
  });
});

describe("adapters", () => {
  it("layout: passes a text's font size to the measurer", () => {
    const seen: number[] = [];
    layout(
      parse("button: A").tree,
      { x: 0, y: 0 },
      {
        measure: (t, s) => (seen.push(s.fontSize), fakeMeasure(t, s)),
        style,
      },
    );
    expect(seen.every((s) => s === FONT_SIZE)).toBe(true);
  });
});

describe("grid width defaults", () => {
  const table = "grid\na, b\n1, 2";
  const gridRect = (ops: DrawOp[]) =>
    rects(ops).find((r) => r.strokeWidth === 2 && r.h === 2 * (fakeMeasure("a", style).h + 14))!;

  it.each(["window", "browser", "box", "form", "section"])(
    "fills the inner width of %s, with fit opting out",
    (container) => {
      const source = (flag = "") =>
        `${container}: T (w=600)\n  ${table.replace("grid", `grid${flag}`).replaceAll("\n", "\n  ")}`;
      const inner = container === "section" ? 600 : 600 - 2 * pad;
      expect(gridRect(draw(source()).ops).w).toBe(inner);
      expect(draw(source())).toEqual(draw(source(" (fill)")));
      expect(gridRect(draw(source(" (fit)")).ops).w).toBe(draw(table).size.w);
      expect(draw(source(" (fill, fit)"))).toEqual(draw(source(" (fit)")));
    },
  );

  it("keeps top-level and row grids content-sized unless explicitly filled", () => {
    const natural = draw(table).size.w;
    expect(gridRect(draw(`text: A much wider sibling than the grid\n${table}`).ops).w).toBe(
      natural,
    );
    const row = `row: (w=600)\n  ${table.replaceAll("\n", "\n  ")}`;
    expect(gridRect(draw(row).ops).w).toBe(natural);
    expect(gridRect(draw(row.replace("grid", "grid (fill)")).ops).w).toBe(600);
    expect(
      gridRect(
        draw(`text: A much wider sibling than the grid\n${table.replace("grid", "grid (fill)")}`)
          .ops,
      ).w,
    ).toBeGreaterThan(natural);
  });

  it("rejects fit on other components", () => {
    expect(parse("button: Save (fit)").errors).toEqual([
      {
        line: 1,
        message:
          'button doesn\'t take "fit" (it takes: w, h, fill, round, disabled, invalid, focus); to keep "(fit)" as text, write "\\(fit)"',
      },
    ]);
  });

  it("fills a grid inserted into a window by after without mutating the tree", () => {
    const { tree, errors } = resolve("extends: base\nafter: anchor\n  grid\n  a, b\n  1, 2", {
      lookup: () => "window: T (w=600)\n  text: Anchor #anchor",
    });
    expect(errors).toEqual([]);
    const before = structuredClone(tree);
    const result = layout(tree, { x: 0, y: 0 }, { measure: fakeMeasure, style });
    expect(gridRect(result.ops).w).toBe(600 - 2 * pad);
    expect(tree).toEqual(before);
  });
});

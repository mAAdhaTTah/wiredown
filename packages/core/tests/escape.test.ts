import { describe, expect, it } from "vitest";
import { parse } from "../src/parse";
import { resolve } from "../src/variants";

const first = (source: string) => parse(source).tree.children[0];

describe("\\( keeps trailing brackets as text", () => {
  it("draws the brackets and sets no option", () => {
    const { tree, errors } = parse("text: Column width \\(fill)");
    expect(errors).toEqual([]);
    expect(tree.children[0].text).toBe("Column width (fill)");
    expect(tree.children[0].opts).toEqual({});
  });

  it("is needed because brackets of options the component takes are options", () => {
    const node = first("text: Column width (fill)");
    expect(node.text).toBe("Column width");
    expect(node.opts).toEqual({ fill: 1 });
  });

  it("works with an id and with options after it", () => {
    const node = first("text: Width \\(fill) #width (focus)");
    expect(node).toMatchObject({ text: "Width (fill)", id: "width", opts: { focus: 1 } });
  });

  it("survives a variant", () => {
    const { tree, errors } = resolve("extends: base\nreplace: w\n  text: Width \\(fill)", {
      lookup: () => "text: Width #w",
    });
    expect(errors).toEqual([]);
    expect(tree.children[0]).toMatchObject({ text: "Width (fill)", id: "w" });
  });
});

describe("the escape hint", () => {
  const hint = (b: string) => `; to keep "${b}" as text, write "\\${b}"`;

  it("is given when text ends in flags the component takes none of", () => {
    expect(parse("text: Results (striped)").errors).toEqual([
      {
        line: 1,
        message: `text doesn't take "striped" (it takes: fill, disabled, invalid, focus)${hint("(striped)")}`,
      },
    ]);
    expect(parse("link: Open (round, plain)").errors.map((e) => e.message)).toEqual([
      `link doesn't take "round" (it takes: fill, disabled, invalid, focus)${hint("(round, plain)")}`,
      `link doesn't take "plain" (it takes: fill, disabled, invalid, focus)${hint("(round, plain)")}`,
    ]);
  });

  it("is not given when the brackets were clearly meant as options", () => {
    const takes = "(it takes: fill, disabled, invalid, focus)";
    expect(parse("text: x (fill, striped)").errors[0].message).toBe(
      `text doesn't take "striped" ${takes}`,
    );
    expect(parse("text: x (w=10)").errors[0].message).toBe(`text doesn't take "w" ${takes}`);
    expect(parse("row (top, plain)\n  text: a").errors[0].message).toBe(
      'row doesn\'t take "plain" (it takes: w, fill, top, disabled, invalid, focus)',
    );
  });
});

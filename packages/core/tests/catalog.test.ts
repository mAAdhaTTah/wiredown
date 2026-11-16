import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../src/components/index.js";
import { CATALOG, COMMON_FLAGS, catalogEntry, optionsOf, parse, resolve } from "../src/index.js";
import type { SpecNode } from "../src/index.js";
import { FLAGS } from "../src/parse.js";

const first = (source: string): SpecNode => parse(source).tree.children[0];
const components = CATALOG.filter((e) => !e.directive);

/** A line of the component with the given options, using its first keyword. */
function line(type: string, opts: string): string {
  if (type === "field") return `field: Name | input: Anna (${opts})`;
  const keyword = catalogEntry(type)!.keywords[0];
  return `${keyword}: ${type === "icon" ? "user" : "x"} (${opts})`;
}

describe("component catalog", () => {
  it("has an entry for every node type a user can write", () => {
    const types = Object.keys(COMPONENTS).filter((t) => t !== "root");
    expect(CATALOG.map((e) => e.type).sort()).toEqual(types.sort());
  });

  it("lists every keyword once", () => {
    const keywords = CATALOG.flatMap((e) => e.keywords);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("parses every keyword to its type", () => {
    for (const e of components) {
      for (const k of e.keywords) {
        // "field:" without "Label |" is an input
        expect(first(`${k}: x`).type, k).toBe(e.type === "field" ? "input" : e.type);
      }
    }
    for (const e of CATALOG.filter((e) => e.directive)) {
      expect(first(`${e.keywords[0]}: x`).type).toBe(e.type);
    }
  });

  it("agrees with the parser on which components hold others", () => {
    for (const e of components.filter((e) => e.type !== "field")) {
      const { errors } = parse(`${e.keywords[0]}: x\n  text: inside`);
      const contains = !errors.some((err) => err.message.includes("can't contain"));
      expect(contains, e.type).toBe(e.container);
    }
  });

  it("accepts every option of every component", () => {
    for (const e of components) {
      for (const opt of optionsOf(e)) {
        const value = e.numbers.includes(opt) ? `${opt}=10` : opt;
        const { tree, errors } = parse(line(e.type, value));
        expect(errors, `${e.type} (${value})`).toEqual([]);
        const node = tree.children[0];
        // a field's component keeps every option; the field gets the ones it forwards
        const target = e.type === "field" ? node.children[0] : node;
        expect(target.opts[opt], `${e.type} (${value})`).toBe(e.numbers.includes(opt) ? 10 : 1);
      }
    }
  });

  it("knows the same flags as the parser", () => {
    const flags = new Set([...COMMON_FLAGS, ...CATALOG.flatMap((e) => e.flags)]);
    expect([...FLAGS].sort()).toEqual([...flags].sort());
  });

  it("gives a field the options forwarded from its component", () => {
    const field = first("field: Name | dropdown: a | b (fill, disabled, floating, required)");
    expect(field.type).toBe("field");
    expect(field.opts).toEqual({ fill: 1, disabled: 1, floating: 1, required: 1 });
    for (const k of catalogEntry("field")!.flags) expect(field.opts[k]).toBe(1);
  });

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(CATALOG))).toEqual(CATALOG);
  });
});

describe("options per component", () => {
  it("reports an option the component doesn't take, as in the proposal", () => {
    const { errors } = parse("box: Team\n  row:\n    button: Save (striped)");
    expect(errors).toEqual([
      {
        line: 3,
        message:
          'button doesn\'t take "striped" (it takes: w, h, fill, round, disabled, invalid, focus); to keep "(striped)" as text, write "\\(striped)"',
      },
    ]);
  });

  it("accepts an option on one component and rejects it on another", () => {
    expect(parse("grid (striped)\na, b").errors).toEqual([]);
    expect(parse("box: Nav (dark)").errors).toEqual([]);
    expect(parse("button: Go (dark, w=100)").errors).toEqual([
      {
        line: 1,
        message:
          'button doesn\'t take "dark" (it takes: w, h, fill, round, disabled, invalid, focus)',
      },
    ]);
    expect(parse("text: x (w=100)").errors).toEqual([
      { line: 1, message: 'text doesn\'t take "w" (it takes: fill, disabled, invalid, focus)' },
    ]);
  });

  it("names the keyword as written", () => {
    expect(parse("btn: Go (striped, w=1)").errors[0].message).toMatch(/^btn doesn't take/);
  });

  it("takes fit only on a grid", () => {
    expect(parse("grid (fit)\na, b").errors).toEqual([]);
    expect(parse("row (fit)\n  text: a").errors).toEqual([
      {
        line: 1,
        message: 'row doesn\'t take "fit" (it takes: w, fill, top, disabled, invalid, focus)',
      },
    ]);
    expect(parse("text: Column width (fit)").errors[0].message).toMatch(/^text doesn't take "fit"/);
  });

  it("checks options after a bare keyword", () => {
    expect(parse("box (top)").errors).toEqual([
      {
        line: 1,
        message:
          'box doesn\'t take "top" (it takes: w, h, fill, plain, dark, collapsible, collapsed, disabled, invalid, focus)',
      },
    ]);
  });

  it("lists only the common flags for a component without its own options", () => {
    expect(parse("checkbox: [x] a (round)").errors).toEqual([
      {
        line: 1,
        message:
          'checkbox doesn\'t take "round" (it takes: disabled, invalid, focus); to keep "(round)" as text, write "\\(round)"',
      },
    ]);
  });

  it("suggests options the component takes first", () => {
    // "stacped" is one letter from stacked and two from striped
    expect(parse("details: a | b (stacped)").errors).toEqual([
      { line: 1, message: 'unknown option "stacped"; did you mean "stacked"?' },
    ]);
    expect(parse("grid (stacped)\na, b").errors).toEqual([
      { line: 1, message: 'unknown option "stacped"; did you mean "striped"?' },
    ]);
    expect(parse("form: x (labl=120)").errors).toEqual([
      { line: 1, message: 'unknown option "labl"; did you mean "label"?' },
    ]);
  });

  it("still leaves brackets of other words as text", () => {
    for (const source of [
      "button: Save (draft)",
      "text: Due date (optional)",
      "text: 3 item(s) selected",
    ]) {
      const { tree, errors } = parse(source);
      expect(errors).toEqual([]);
      expect(tree.children[0].text).toBe(source.slice(source.indexOf(":") + 2));
    }
  });

  it("takes a field's options on the field's component", () => {
    expect(parse("field: Name | checkbox: [x] Yes (required, fill)").errors).toEqual([]);
    expect(parse("checkbox: [x] Yes (required, w=1)").errors).toEqual([
      {
        line: 1,
        message: 'checkbox doesn\'t take "required" (it takes: disabled, invalid, focus)',
      },
      { line: 1, message: 'checkbox doesn\'t take "w" (it takes: disabled, invalid, focus)' },
    ]);
    expect(parse("field: Name | input: x (striped)").errors).toEqual([
      {
        line: 1,
        message:
          'input doesn\'t take "striped" (it takes: w, h, fill, empty, disabled, invalid, focus, floating, required); to keep "(striped)" as text, write "\\(striped)"',
      },
    ]);
  });

  it("checks options in a variant's replacement", () => {
    const { errors } = resolve("extends: base\nreplace: go\n  button: Go (striped, w=1)", {
      lookup: () => "button: Go #go",
    });
    expect(errors).toEqual([
      {
        line: 3,
        message:
          'button doesn\'t take "striped" (it takes: w, h, fill, round, disabled, invalid, focus)',
      },
    ]);
  });

  it("reports options on a variant directive", () => {
    const { errors } = resolve("extends: base\nafter: go (w=1)\n  text: x", {
      lookup: () => "button: Go #go",
    });
    expect(errors).toEqual([{ line: 2, message: 'after doesn\'t take "w" (it takes no options)' }]);
  });
});

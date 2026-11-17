import { describe, expect, it } from "vitest";
import { extendsId, parse, resolve, serialize } from "../src/index";
import type { SpecNode } from "../src/index";

const BASE = [
  "window: Review (id=win)",
  "  text: 12 selected (id=selection)",
  "  row: (id=apply-row)",
  "    button: *Apply",
  "  alert: {warning} 9 stale (id=notice)",
  "  grid (id=boards)",
  "  [x] | Board | Status | Applied | Gap",
  "  [x] | 2c3c4c | Fresh | Bet 33% | 0.00",
  "  [ ] | 4h7h9h | Stale | — | —",
  "  [x] | 5d6h9s | Fresh | Bet 33% | 0.00",
].join("\n");
const screens: Record<string, string> = { base: BASE };
const run = (variant: string, extra: Record<string, string> = {}) =>
  resolve(variant, {
    lookup: (id) => ({ ...screens, ...extra })[id],
    known: () => Object.keys({ ...screens, ...extra }),
  });
const win = (r: { tree: SpecNode }) => r.tree.children[0];
const types = (n: SpecNode) => n.children.map((c) => c.type);

describe("ids", () => {
  it("reads (id=name) without touching the numeric options", () => {
    const node = parse("button: Save (id=save, w=120)").tree.children[0];
    expect(node).toMatchObject({ text: "Save", id: "save", opts: { w: 120 } });
  });

  it("puts a field's id on the field", () => {
    const field = parse("field: Name | input: Anna (id=name)").tree.children[0];
    expect(field.id).toBe("name");
    expect(field.children[0].id).toBeUndefined();
  });

  it("reads an id on a bare keyword", () => {
    expect(parse("grid (id=boards)\na, b").tree.children[0].id).toBe("boards");
  });

  it("reports an id used twice", () => {
    const { errors } = resolve("button: A (id=x)\nbutton: B (id=x)");
    expect(errors).toEqual([
      { line: 2, message: 'the id "x" is used twice; first used on line 1' },
    ]);
  });
});

describe("extends", () => {
  it("is found on the first line that isn't a comment", () => {
    expect(extendsId("// after applying\nextends: ^base\nremove: notice")).toBe("base");
    expect(extendsId("window: A")).toBeNull();
    expect(extendsId("extends: ^2fa")).toBe("2fa");
  });

  it("names a base's error by its line in the base block", () => {
    expect(run("extends: bad", { bad: "text: a\nbuton: B" }).errors).toEqual([
      { line: 1, message: 'in "bad", line 2: unknown component "buton"; did you mean "button"?' },
    ]);
  });

  it("draws the base unchanged when nothing else is said", () => {
    const r = run("extends: base");
    expect(r.errors).toEqual([]);
    expect(serialize(r.tree)).toBe(serialize(resolve(BASE).tree));
  });

  it("replaces the component with the same id, in place", () => {
    const r = run("extends: base\nreplace: notice\n  alert: {check} Applied");
    expect(r.errors).toEqual([]);
    expect(types(win(r))).toEqual(["text", "row", "alert", "grid"]);
    expect(win(r).children[2].text).toBe("{check} Applied");
  });

  it("keeps a container's children when only its own line is replaced", () => {
    const r = run("extends: base\nreplace: win\n  window: Review, narrow (w=640)");
    expect(win(r)).toMatchObject({ text: "Review, narrow", opts: { w: 640 } });
    expect(types(win(r))).toEqual(["text", "row", "alert", "grid"]);
  });

  it("removes components", () => {
    const r = run("extends: base\nremove: apply-row, notice");
    expect(types(win(r))).toEqual(["text", "grid"]);
  });

  it("adds components after and before one", () => {
    const r = run("extends: base\nafter: boards\n  text: Footnote\nbefore: selection\n  h2: Title");
    expect(r.errors).toEqual([]);
    expect(types(win(r))).toEqual(["h2", "text", "row", "alert", "grid", "text"]);
  });

  it("accepts changes indented under extends", () => {
    const r = run("extends: base\n  remove: notice");
    expect(r.errors).toEqual([]);
    expect(types(win(r))).toEqual(["text", "row", "grid"]);
  });

  it("does not change the base for the next reader", () => {
    run("extends: base\nremove: notice");
    expect(types(win(run("extends: base")))).toEqual(["text", "row", "alert", "grid"]);
  });

  it("extends a variant", () => {
    const r = run("extends: applied\nremove: selection", {
      applied: "extends: base\nremove: notice",
    });
    expect(r.errors).toEqual([]);
    expect(types(win(r))).toEqual(["row", "grid"]);
  });
});

describe("rows", () => {
  const rows = (r: { tree: SpecNode }) => {
    const grid = win(r).children.find((c) => c.type === "grid")!;
    return [grid.text, ...grid.body].filter(Boolean);
  };

  it("replaces a row by its key, keeping cells written as =", () => {
    const r = run("extends: base\nrows: boards\n  *[x] | 2c3c4c | = | Bet 75% | 0.04");
    expect(r.errors).toEqual([]);
    expect(rows(r)[1]).toBe("*[x] | 2c3c4c | Fresh | Bet 75% | 0.04");
  });

  it("keeps the cells a short row leaves out", () => {
    const r = run("extends: base\nrows: boards\n  [ ] | 2c3c4c");
    expect(rows(r)[1]).toBe("[ ] | 2c3c4c | Fresh | Bet 33% | 0.00");
  });

  it("removes a row and appends a new one", () => {
    const r = run("extends: base\nrows: boards\n  remove 5d6h9s\n  [x] | AcKcQc | Fresh | — | —");
    expect(r.errors).toEqual([]);
    expect(rows(r).map((row) => row.split(" | ")[1])).toEqual([
      "Board",
      "2c3c4c",
      "4h7h9h",
      "AcKcQc",
    ]);
  });

  const members = [
    "grid #members",
    "[ ] | Name | Email | Role | Status",
    "[ ] | Maja Berg | maja@example.com | Member | Invited",
  ].join("\n");

  it("lets rows fill a grid that has none yet", () => {
    const r = run("extends: base\nrows: empty\n  Name | Role\n  Anna | Admin", {
      base: "grid #empty",
    });
    expect(r.errors).toEqual([]);
    const grid = r.tree.children[0];
    expect([grid.text, ...grid.body].filter(Boolean)).toEqual(["Name | Role", "Anna | Admin"]);
  });

  it.each(["Maja Berg", "Anna Svensson"])("rejects an overwide row for %s", (key) => {
    const r = run(`extends: base\nrows: members\n  [ ] | ${key} | = | = | = | Active`, {
      base: members,
    });
    expect(r.errors).toEqual([
      {
        line: 3,
        message: `rows: "${key}" has 6 cells, but the grid "members" has 5 columns`,
      },
    ]);
    expect(r.tree.children[0]).toMatchObject({
      text: "[ ] | Name | Email | Role | Status",
      body: ["[ ] | Maja Berg | maja@example.com | Member | Invited"],
    });
  });

  it("rejects an overwide new row without keep-cell placeholders", () => {
    const r = run(
      "extends: base\nrows: members\n  [ ] | Anna Svensson | anna@example.com | Admin | Active | Extra",
      { base: members },
    );
    expect(r.errors).toEqual([
      {
        line: 3,
        message: 'rows: "Anna Svensson" has 6 cells, but the grid "members" has 5 columns',
      },
    ]);
    expect(r.tree.children[0]).toMatchObject({
      text: "[ ] | Name | Email | Role | Status",
      body: ["[ ] | Maja Berg | maja@example.com | Member | Invited"],
    });
  });

  it.each(["", "*", ">"])("accepts a full-width patch with mark %j", (mark) => {
    const r = run(`extends: base\nrows: members\n  ${mark}[ ] | Maja Berg | = | = | Active`, {
      base: members,
    });
    expect(r.errors).toEqual([]);
    expect(r.tree.children[0].body).toEqual([
      `${mark}[ ] | Maja Berg | maja@example.com | Member | Active`,
    ]);
  });

  it("accepts a shorter new row", () => {
    const r = run("extends: base\nrows: members\n  [ ] | Anna Svensson", { base: members });
    expect(r.errors).toEqual([]);
    expect(r.tree.children[0].body).toEqual([
      "[ ] | Maja Berg | maja@example.com | Member | Invited",
      "[ ] | Anna Svensson",
    ]);
  });

  it("checks comma-separated rows against their header width", () => {
    const base = members.replaceAll(" | ", ", ");
    const r = run(
      "extends: base\nrows: members\n  [ ], Maja Berg, =, =, =, Active\n  >[ ], Maja Berg, =, =, Active",
      { base },
    );
    expect(r.errors).toEqual([
      {
        line: 3,
        message: 'rows: "Maja Berg" has 6 cells, but the grid "members" has 5 columns',
      },
    ]);
    expect(r.tree.children[0].body).toEqual([">[ ], Maja Berg, maja@example.com, Member, Active"]);
  });

  it("lines up a patch that leaves out the checkbox cell", () => {
    const base =
      "grid #g\n[ ] | Name | Email | Role\n[ ] | Anna | a@x | Member\n[x] | Erik | e@x | Member";
    const without = run("extends: base\nrows: g\n  Anna | = | Admin", { base });
    const withBox = run("extends: base\nrows: g\n  [ ] | Anna | = | Admin", { base });
    expect(without.errors).toEqual([]);
    expect(without.tree).toEqual(withBox.tree);
    expect(without.tree.children[0].body).toEqual([
      "[ ] | Anna | a@x | Admin",
      "[x] | Erik | e@x | Member",
    ]);
  });

  it("lines up a new row that leaves out the checkbox cell", () => {
    const base = "grid #g\n[ ] | Name | Email\n[ ] | Anna | a@x";
    const r = run("extends: base\nrows: g\n  Cara | c@x\n  Dan | d@x | x", { base });
    expect(r.errors).toEqual([
      {
        line: 4,
        message: 'rows: "Dan" has 4 cells with its checkbox, but the grid "g" has 3 columns',
      },
    ]);
    expect(r.tree.children[0].body).toEqual(["[ ] | Anna | a@x", "[ ] | Cara | c@x"]);
    // without a checkbox column, a new row is added as written
    const plain = run("extends: base\nrows: g\n  Cara | c@x", { base: "grid #g\nName | Email" });
    expect(plain.tree.children[0].body).toEqual(["Cara | c@x"]);
  });

  it("counts a patch's width after lining it up", () => {
    // "Anna" in the checkbox column was the old reading of this patch
    const base = "grid #g\n[ ] | Name | Role\n[ ] | Anna | Member";
    expect(run("extends: base\nrows: g\n  Anna | = | Admin", { base }).errors).toEqual([
      {
        line: 3,
        message: 'rows: "Anna" has 4 cells with its checkbox, but the grid "g" has 3 columns',
      },
    ]);
  });

  it("rejects a patch or removal whose key matches several rows", () => {
    const base = "grid #members\n[ ] | Name | Role\n[ ] | Anna | Member\n[ ] | Anna | Admin";
    const r = run("extends: base\nrows: members\n  Anna | = | Owner\n  remove Anna", { base });
    expect(r.errors).toEqual([
      { line: 3, message: 'rows: "Anna" matches 2 rows in the grid "members"' },
      { line: 4, message: 'rows: "Anna" matches 2 rows in the grid "members"' },
    ]);
    expect(r.tree.children[0].body).toEqual(["[ ] | Anna | Member", "[ ] | Anna | Admin"]);
    // a grid no variant patches may repeat a key
    expect(run("extends: base", { base }).errors).toEqual([]);
  });

  it("never treats the header as a row to change", () => {
    const r = run("extends: base\nrows: boards\n  remove Board");
    expect(r.errors[0].message).toContain('no row "Board"');
  });
});

describe("variant errors", () => {
  it("names the ids there are when one is wrong", () => {
    const r = run("extends: base\nremove: notise");
    expect(r.errors).toEqual([
      {
        line: 2,
        message: 'remove: "base" has no component #notise; did you mean "notice"?',
      },
    ]);
  });

  it("names the screens there are when the base is wrong", () => {
    const r = run("extends: bass");
    expect(r.errors).toEqual([
      { line: 1, message: 'extends: no screen with the id "bass"; did you mean "base"?' },
    ]);
    expect(r.tree.children).toEqual([]);
  });

  it("asks what a component line without a verb does", () => {
    const r = run("extends: base\nbutton: Stray");
    expect(r.errors).toEqual([
      {
        line: 2,
        message:
          '"button:" in a variant needs a command: "replace: <id>", "after: <id>" or "before: <id>"',
      },
    ]);
  });

  it("reports a row that isn't there, with the rows that are", () => {
    const r = run("extends: base\nrows: boards\n  remove 9s9h9d");
    expect(r.errors).toEqual([
      {
        line: 3,
        message: 'no row "9s9h9d" in the grid "boards"; its rows are: 2c3c4c, 4h7h9h, 5d6h9s',
      },
    ]);
  });

  it("reports errors in the base against the extends line", () => {
    const r = run("extends: broken", { broken: "window: A\n  buton: B" });
    expect(r.errors[0]).toMatchObject({ line: 1 });
    expect(r.errors[0].message).toContain('in "broken", line 2');
  });

  it("stops a screen that extends itself", () => {
    const r = run("extends: a", { a: "extends: b", b: "extends: a" });
    expect(r.errors[r.errors.length - 1].message).toContain("extends itself");
  });

  it("rejects a directive outside a variant", () => {
    const r = resolve("window: A\nremove: x");
    expect(r.errors[0].message).toContain("only works in a block whose first line is");
  });

  it("names a malformed screen id in extends:", () => {
    expect(resolve("extends: a_b\nremove: x").errors).toEqual([
      { line: 1, message: 'extends: invalid screen id "a_b"; use letters, digits and hyphens' },
    ]);
  });
});

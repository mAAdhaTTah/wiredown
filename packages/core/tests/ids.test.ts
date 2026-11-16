import { describe, expect, it } from "vitest";
import { parse, resolve, serialize } from "../src/index.js";

describe("#id shorthand", () => {
  it("is equivalent to the long form, including options", () => {
    expect(parse("button: Invite member #invite (disabled)")).toEqual(
      parse("button: Invite member (id=invite, disabled)"),
    );
  });

  it.each(["grid #members", "grid: #members", "grid #members (disabled)"])(
    "accepts an id as the whole content: %s",
    (source) => {
      const { tree, errors } = parse(source);
      expect(errors).toEqual([]);
      expect(tree.children[0]).toMatchObject({ type: "grid", text: "", id: "members" });
    },
  );

  it("accepts digits and hyphens after the initial lowercase letter", () => {
    expect(parse("text: 3 of 5 seats used #seats-2").tree.children[0]).toMatchObject({
      text: "3 of 5 seats used",
      id: "seats-2",
    });
  });

  it.each([
    "C#",
    "Step #3",
    "a#b",
    "Tag #Urgent",
    "Tag #with_under",
    "# | Name | Role",
    "#id later",
  ])("keeps non-id text: %s", (text) => {
    const { tree, errors } = parse(`text: ${text}`);
    expect(errors).toEqual([]);
    expect(tree.children[0].text).toBe(text);
    expect(tree.children[0].id).toBeUndefined();
  });

  it("keeps grid headers and rows literal, including a trailing #word", () => {
    const { tree, errors } = parse("grid #members\n# | Name | Role\n1 | Anna | #admin");
    expect(errors).toEqual([]);
    expect(tree.children[0]).toMatchObject({
      id: "members",
      body: ["# | Name | Role", "1 | Anna | #admin"],
    });
  });

  it("unescapes literal hashes without assigning an id", () => {
    const { tree, errors } = parse(String.raw`text: Tag \#urgent (disabled)`);
    expect(errors).toEqual([]);
    expect(tree.children[0]).toMatchObject({ text: "Tag #urgent", opts: { disabled: 1 } });
    expect(tree.children[0].id).toBeUndefined();
  });

  it("requires whitespace between a bare keyword and its id", () => {
    expect(parse("grid#members").errors).toHaveLength(1);
  });

  it("assigns a field id to the whole field", () => {
    const field = parse("field: Name | input: Anna #name").tree.children[0];
    expect(field.id).toBe("name");
    expect(field.children[0].id).toBeUndefined();
  });

  it.each(["x", "y"])("rejects both forms even when the long id is %s", (id) => {
    expect(parse(`button: Invite #x (id=${id})`).errors).toEqual([
      { line: 1, message: "use either #id or (id=...), not both" },
    ]);
  });

  it.each([
    ["#same", "#same"],
    ["#same", "(id=same)"],
    ["(id=same)", "#same"],
    ["(id=same)", "(id=same)"],
  ])("rejects duplicate ids across nested components: %s and %s", (a, b) => {
    const source = `box ${a}\n  button: Invite ${b}`;
    const errors = [{ line: 2, message: 'the id "same" is used twice; first used on line 1' }];
    expect(parse(source).errors).toEqual(errors);
    expect(resolve(source).errors).toEqual(errors);
  });

  const lookup = () => "box #panel\n  button: Invite #invite\n  grid #members\n  Name | Role";

  it("supports replacement and bare-id variant verbs", () => {
    const result = resolve(
      "extends: base\nbutton: Invited #invite\nafter: members\n  text: Done #done\nremove: members",
      { lookup },
    );
    expect(result.errors).toEqual([]);
    expect(result.tree.children[0].children.map((node) => node.id)).toEqual(["invite", "done"]);
    expect(result.tree.children[0].children[0].text).toBe("Invited");
  });

  it("rejects an insertion that duplicates a base id", () => {
    const result = resolve("extends: base\nafter: members\n  text: Again #invite", { lookup });
    expect(result.errors).toEqual([
      { line: 3, message: 'the id "invite" is already used in "base"' },
    ]);
  });

  it("reports the variant's line when the insertion lands before the base component", () => {
    const result = resolve("extends: base\nbefore: invite\n  text: Again #members", { lookup });
    expect(result.errors).toEqual([
      { line: 3, message: 'the id "members" is already used in "base"' },
    ]);
  });

  it("lets a replacement keep the id it replaces, but not take another one", () => {
    expect(resolve("extends: base\nbutton: New #invite", { lookup }).errors).toEqual([]);
    const result = resolve("extends: base\nbox #invite\n  text: x #members", { lookup });
    expect(result.errors).toEqual([
      { line: 3, message: 'the id "members" is already used in "base"' },
    ]);
  });

  it("reads ids on indented components, tabs, links and grey text", () => {
    const { tree, errors } = parse(
      "box\n  tabs: A | *B #tabs\n  link: Docs #docs\n  text: -muted- #note",
    );
    expect(errors).toEqual([]);
    expect(tree.children[0].children.map((node) => node.id)).toEqual(["tabs", "docs", "note"]);
  });

  it("round-trips shorthand, long-only ids, and literal hashes", () => {
    const source = String.raw`box #panel
  text: Tag \#urgent
  button: Invite #invite (disabled)
  text: Legacy (id=Legacy_ID)
  grid #members
  # | Name
  1 | #word`;
    const parsed = parse(source);
    expect(parsed.errors).toEqual([]);
    const serialized = serialize(parsed.tree);
    expect(serialized).toContain("#invite (disabled)");
    expect(serialized).toContain("(id=Legacy_ID)");
    expect(parse(serialized)).toEqual(parsed);
  });
});

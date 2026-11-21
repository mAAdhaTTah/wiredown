import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScreens, layoutScreen, parseScreens } from "../src/index";

const block = (source: string, id = "base") => `\`\`\`wiredown\n${source}\n\`\`\`\n^${id}`;

describe("screens documents", () => {
  it("checks each block with an injected block checker, keeping file-level findings", () => {
    const seen: string[] = [];
    const md =
      block("text: A", "a") + "\n\n" + block("text: B", "a") + "\n\n```wiredown\ntext: C\n";
    const result = checkScreens(md, (source, options) => {
      seen.push(`${source} ${options.known?.().join(",")}`);
      return {
        tree: { type: "root", text: "", opts: {}, body: [], children: [] },
        errors: [{ line: 1, message: "bad" }],
        warnings: [],
      };
    });
    expect(seen).toEqual(["text: A a", "text: B a"]);
    expect(result.errors.map((e) => [e.line, e.message])).toEqual([
      [11, "unclosed code fence"],
      [9, 'duplicate block id "a"; first used on line 4'],
      [2, "bad"],
      [7, "bad"],
    ]);
  });

  it("resolves the syntax proposal's running example across blocks", () => {
    const md = readFileSync(new URL("./fixtures/screens.md", import.meta.url), "utf8");
    const result = checkScreens(md);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.screens.map((s) => s.id)).toEqual(["team-members", "team-members-after-remove"]);
    expect(JSON.stringify(result.screens[1].tree)).toContain("2 of 5 seats used");
    expect(layoutScreen(result.screens[1].tree).boxes.notice).toBeDefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("maps errors and warnings to file content lines without trimming blanks", () => {
    const result = checkScreens(
      `# Heading\n\n${block("\nbutton: Save\nbuton: Bad\ntext: {warnin}")}`,
    );
    expect(result.screens[0].line).toBe(4);
    expect(result.errors[0].line).toBe(6);
    expect(result.warnings[0].line).toBe(7);
    expect(result.errors[0].screen).toBe("base");
  });

  it("skips frontmatter and other languages, supports longer and tilde fences and CRLF", () => {
    const md = [
      "---",
      "# hidden",
      "```wiredown",
      "---",
      "# Team #",
      "```js",
      "## hidden",
      "````wiredown",
      "```",
      "````wiredown",
      "button: Save",
      "```",
      "````",
      "",
      "^save",
      "Other",
      "---",
      "~~~wiredown",
      "text: Hello",
      "~~~",
      "^hello",
    ].join("\r\n");
    const screens = parseScreens(md);
    expect(screens).toEqual([
      { heading: "Team", source: "button: Save\n```", line: 11, id: "save" },
      { heading: "Other", source: "text: Hello", line: 19, id: "hello" },
    ]);
  });

  it("warns for missing ids and only allows one blank before an id", () => {
    const md = block("button: Save").replace("\n^base", "\n\n\n^base");
    expect(parseScreens(md)[0].id).toBeUndefined();
    expect(checkScreens(md).warnings[0].message).toContain("can't be embedded");
  });

  it("reports duplicate and invalid ids at their file lines", () => {
    const result = checkScreens(
      [block("text: First"), block("text: Second"), block("text: Bad", "bad_id")].join("\n"),
    );
    expect(result.errors).toEqual([
      { line: 8, message: 'duplicate block id "base"; first used on line 4', screen: "base" },
      { line: 12, message: 'invalid block id "bad_id"', screen: "bad_id" },
    ]);
  });

  it("rejects unclosed fences while check retains completed screens", () => {
    const md = block("text: Hello") + "\n```wiredown\ntext: Unclosed";
    expect(() => parseScreens(md)).toThrow("line 5: unclosed code fence");
    expect(checkScreens(md).errors).toEqual([{ line: 5, message: "unclosed code fence" }]);
    expect(checkScreens(md).screens).toHaveLength(1);
  });

  it("keeps the base error wording in a variant, with the base's file line", () => {
    const result = checkScreens(block("buton: Bad") + "\n" + block("extends: base", "variant"));
    expect(
      result.errors.some((e) => e.screen === "variant" && e.message.includes('in "base", line 2')),
    ).toBe(true);
  });

  it("names only file lines for an error in a base of a base", () => {
    const md = [
      block("text: a\nbuton: Bad", "c"),
      block("extends: c", "b"),
      block("extends: b", "a"),
    ].join("\n\n");
    expect(checkScreens(md).errors.filter((e) => e.screen === "a")).toEqual([
      {
        line: 13,
        message:
          'in "b", line 8: in "c", line 3: unknown component "buton"; did you mean "button"?',
        screen: "a",
      },
    ]);
  });

  it("resolves a variant of a block id that starts with a digit", () => {
    const md =
      block("text: Code #code\ntext: Kept", "2fa") +
      "\n" +
      block("extends: ^2fa\nremove: code", "v");
    const result = checkScreens(md);
    expect(result.errors).toEqual([]);
    expect(result.screens[1].tree.children.map((c) => c.text)).toEqual(["Kept"]);
  });

  it("reads a file that opens with a rule, not frontmatter", () => {
    const screens = parseScreens("---\n# A\n```wiredown\ntext: a\n```\n^a");
    expect(screens).toEqual([{ id: "a", heading: "A", source: "text: a", line: 4 }]);
  });

  it("resolves a variant whose base comes later in the file", () => {
    const file =
      "```wiredown\nextends: b\nremove: x\n```\n^a\n\n```wiredown\ntext: t #x\ntext: u\n```\n^b";
    expect(checkScreens(file).errors).toEqual([]);
  });
});

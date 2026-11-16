import { describe, expect, it } from "vitest";
import { check, resolve } from "../src/index.js";

// the running example of the syntax proposal
const TEAM_MEMBERS = `window: Team settings
  row:
    h2: Members
    text: 3 of 5 seats used #seats
    button: *Invite member #invite
  alert: {info} Invitations expire after 7 days. #notice
  grid #members
  [ ] | Name | Email | Role | Status
  [ ] | Anna Svensson | anna@example.com | Admin | Active
  [ ] | Erik Lund | erik@example.com | Member | Active
  [ ] | Maja Berg | maja@example.com | Member | Invited`;

describe("check", () => {
  it("has no errors or warnings for the proposal's running example", () => {
    const r = check(TEAM_MEMBERS);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("returns what resolve returns, plus warnings", () => {
    const screens: Record<string, string> = { "team-members": TEAM_MEMBERS };
    const options = { lookup: (id: string) => screens[id], known: () => Object.keys(screens) };
    const variant = "extends: team-members\nreplace: seats\n  text: 2 of 5 seats used (striped)";
    const { tree, errors, warnings } = check(variant, options);
    expect({ tree, errors }).toEqual(resolve(variant, options));
    expect(errors).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("warns about a {name} one letter off an icon", () => {
    expect(check("alert: {warnin} Disk almost full\nbutton: {Serch}").warnings).toEqual([
      {
        line: 1,
        message: "{warnin} is not an icon, so it is drawn as text; did you mean {warning}?",
      },
      {
        line: 2,
        message: "{Serch} is not an icon, so it is drawn as text; did you mean {search}?",
      },
    ]);
  });

  it("stays silent about braces that are not near an icon", () => {
    expect(check("text: Hello {name}, you have {count} messages").warnings).toEqual([]);
    expect(check("text: {Info} and {SEARCH}").warnings).toEqual([]);
  });

  it("warns about characters Excalifont has no width for, per line", () => {
    const r = check("text: More ⋯\ntext: fine\ntext: ⋯ and ☃ ⋯");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      {
        line: 1,
        message: '"⋯" is not in Excalifont, so a fallback font draws it at an estimated width',
      },
      {
        line: 3,
        message:
          '"⋯", "☃" are not in Excalifont, so a fallback font draws them at an estimated width',
      },
    ]);
  });

  it("warns about brackets drawn as text that hold an option", () => {
    expect(
      check("button: Save (striped, primry)\nfield: Name | input: x (fill, a, b)").warnings,
    ).toEqual([
      {
        line: 1,
        message:
          '"(striped, primry)" is drawn as text because "primry" is not an option; write \\( to keep the brackets as text',
      },
      {
        line: 2,
        message:
          '"(fill, a, b)" is drawn as text because "a", "b" are not options; write \\( to keep the brackets as text',
      },
    ]);
  });

  it("stays silent about brackets of prose, escaped brackets and continuation lines", () => {
    for (const source of [
      "button: Save (draft)",
      "text: Due date (optional)",
      "text: 3 item(s) selected",
      "button: Save \\(striped, primry)",
      "text: a\n  b (striped, primry)",
    ]) {
      expect(check(source).warnings).toEqual([]);
    }
  });

  it("warns about a retired option drawn as text", () => {
    expect(check("button: Old (hi)").warnings).toEqual([
      { line: 1, message: '"(hi)" is drawn as text; the highlight option is now (focus)' },
    ]);
  });

  it("warns about a grid row longer than its header", () => {
    const source = [
      "grid: [ ] | Name | Role",
      "  |---|---|---|",
      "  // a comment",
      "  [ ] | Anna | Admin |",
      "  *[x] | Erik | Member | x",
      "  > [ ] | Maja",
      "text: done",
      "grid",
      "  A, B",
      "  1, 2, 3",
    ].join("\n");
    expect(check(source).warnings).toEqual([
      { line: 5, message: "row has 4 cells but the header has 3" },
      { line: 10, message: "row has 3 cells but the header has 2" },
    ]);
  });

  it("skips comment lines", () => {
    expect(check("// {warnin} ⋯\ntext: x").warnings).toEqual([]);
  });

  it("warns on the lines of a variant", () => {
    const r = check("extends: base\nreplace: x\n  text: {chek} done", {
      lookup: () => "text: x #x",
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      { line: 3, message: "{chek} is not an icon, so it is drawn as text; did you mean {check}?" },
    ]);
  });

  it("treats a word such as constructor as ordinary text, not a retired option", () => {
    expect(check("text: Save (constructor)").warnings).toEqual([]);
    expect(check("button: X (constructor=2)").errors).toEqual([
      { line: 1, message: 'unknown option "constructor"' },
    ]);
  });
});

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
});

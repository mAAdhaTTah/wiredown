import { describe, expect, it } from "vitest";
import { resolve, serialize } from "../src/index.js";
import type { SpecNode } from "../src/index.js";

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

const run = (variant: string, extra: Record<string, string> = {}) => {
  const screens: Record<string, string> = { "team-members": TEAM_MEMBERS, ...extra };
  return resolve(variant, { lookup: (id) => screens[id], known: () => Object.keys(screens) });
};
const win = (r: { tree: SpecNode }) => r.tree.children[0];
const byId = (node: SpecNode, id: string): SpecNode | undefined =>
  node.id === id ? node : node.children.map((c) => byId(c, id)).find(Boolean);

describe("replace:", () => {
  it("resolves the proposal's example", () => {
    const r = run(`extends: team-members
replace: seats
  text: 2 of 5 seats used
replace: notice
  alert: {check} Erik Lund was removed from the team. [Undo]
rows: members
  [ ] | Maja Berg | = | = | = | Active
  remove Erik Lund
after: members
  text: -Removed members keep access until the end of the day-`);
    expect(r.errors).toEqual([]);
    expect(serialize({ ...win(r), children: win(r).children.slice(0, 2) })).toBe(
      [
        "row",
        "  h2: Members",
        "  text: 2 of 5 seats used #seats",
        "  button: *Invite member #invite",
        "alert: {check} Erik Lund was removed from the team. [Undo] #notice",
      ].join("\n"),
    );
    const grid = byId(win(r), "members")!;
    expect(grid.body.map((row) => row.split(" | ")[1])).toEqual(["Anna Svensson", "Maja Berg"]);
    expect(win(r).children.map((c) => c.type)).toEqual(["row", "alert", "grid", "text"]);
  });

  it("rejects the proposal's old form, naming the id to replace", () => {
    const r = run(`extends: team-members
text: 2 of 5 seats used (id=seats)
alert: {check} Erik Lund was removed from the team. [Undo] (id=notice)
rows: members
  [ ] | Maja Berg | = | = | = | Active
  remove Erik Lund`);
    expect(r.errors).toEqual([
      {
        line: 2,
        message: 'in a variant, say what this does: "replace: seats", "after: …" or "before: …"',
      },
      {
        line: 3,
        message: 'in a variant, say what this does: "replace: notice", "after: …" or "before: …"',
      },
    ]);
  });

  it("asks generically for a line whose id is not in the base", () => {
    const r = run("extends: team-members\n\nbutton: Remove #remove");
    expect(r.errors).toEqual([
      {
        line: 3,
        message: 'in a variant, say what this does: "replace: …", "after: …" or "before: …"',
      },
    ]);
  });

  it("keeps the replaced component's id", () => {
    const r = run("extends: team-members\nreplace: invite\n  button: Invite member (disabled)");
    expect(r.errors).toEqual([]);
    expect(byId(win(r), "invite")).toMatchObject({ type: "button", opts: { disabled: 1 } });
  });

  it("takes an id the replacement declares, freeing the old one", () => {
    const r = run("extends: team-members\nreplace: invite\n  button: Resend #resend");
    expect(r.errors).toEqual([]);
    expect(byId(win(r), "invite")).toBeUndefined();
    expect(byId(win(r), "resend")).toMatchObject({ text: "Resend" });
  });

  it("rejects a declared id used elsewhere in the base", () => {
    const r = run("extends: team-members\nreplace: invite\n  button: Invite #seats");
    expect(r.errors).toEqual([
      { line: 3, message: 'the id "seats" is already used in "team-members"' },
    ]);
  });

  it("lets a later variant target the inherited id", () => {
    const r = run("extends: removed\nreplace: notice\n  alert: {check} Undone", {
      removed: "extends: team-members\nreplace: notice\n  alert: {check} Erik Lund was removed",
    });
    expect(r.errors).toEqual([]);
    expect(byId(win(r), "notice")).toMatchObject({ type: "alert", text: "{check} Undone" });
  });

  it("replaces a container with its new children", () => {
    const r = run("extends: team-members\nreplace: notice\n  box #notice\n    text: Inside");
    expect(r.errors).toEqual([]);
    const box = byId(win(r), "notice")!;
    expect(box.type).toBe("box");
    expect(box.children.map((c) => c.text)).toEqual(["Inside"]);
  });

  it("keeps a container's children when the body is a bare line of the same type", () => {
    const panel = resolve("extends: base\nreplace: panel\n  box: Panel", {
      lookup: () => "box #panel\n  text: A\n  text: B",
    });
    expect(panel.errors).toEqual([]);
    expect(panel.tree.children[0]).toMatchObject({ type: "box", text: "Panel", id: "panel" });
    expect(panel.tree.children[0].children.map((c) => c.text)).toEqual(["A", "B"]);
  });

  it.each([
    ["no", "extends: team-members\n\nreplace: invite", 0],
    ["two", "extends: team-members\n\nreplace: invite\n  button: A\n  button: B", 2],
  ])("rejects %s body components on its own line", (_, source, n) => {
    expect(run(source).errors).toEqual([
      {
        line: 3,
        message: `replace: "invite" needs exactly one component indented under it, not ${n}`,
      },
    ]);
  });

  it("names the ids there are when the target is wrong", () => {
    expect(run("extends: team-members\nreplace: invte\n  button: x").errors).toEqual([
      {
        line: 2,
        message: 'replace: "team-members" has no component with (id=invte); did you mean "invite"?',
      },
    ]);
    expect(run("extends: team-members\nreplace: zzz\n  button: x").errors).toEqual([
      {
        line: 2,
        message:
          'replace: "team-members" has no component with (id=zzz); its ids are: seats, invite, notice, members',
      },
    ]);
  });

  it("only works in a variant", () => {
    expect(resolve("window: A\n  text: x #seats\nreplace: seats\n  text: y").errors).toEqual([
      {
        line: 3,
        message: '"replace:" only works in a block whose first line is "extends: <screen id>"',
      },
    ]);
  });

  it("rejects a change nested inside another change", () => {
    const inside = (source: string) => run(source).errors;
    expect(inside("extends: team-members\nreplace: seats\n  remove: seats")).toEqual([
      {
        line: 3,
        message: '"remove:" can\'t go inside "replace:"; put it at the top level of the variant',
      },
    ]);
    expect(inside("extends: team-members\nafter: seats\n  replace: seats\n    text: x")).toEqual([
      {
        line: 3,
        message: '"replace:" can\'t go inside "after:"; put it at the top level of the variant',
      },
    ]);
  });
});

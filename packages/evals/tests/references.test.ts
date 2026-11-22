import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkWithBaseline, newReference, OLD_REFERENCE, referenceText } from "../src/arms.ts";
import { loadBaseline } from "../src/baseline.ts";
import type { BaselineCore } from "../src/baseline.ts";
import { hasBaseline } from "./helpers.ts";

const oldDoc = readFileSync(OLD_REFERENCE, "utf8");

/** The bodies of fenced blocks with an info string, dedented. */
function blocks(markdown: string, info: string): string[] {
  const out: string[] = [];
  const re = new RegExp("^( *)```" + info + "\\n([\\s\\S]*?)^\\1```$", "gm");
  for (const m of markdown.matchAll(re)) {
    out.push(m[2].replace(new RegExp(`^${m[1]}`, "gm"), "").trimEnd());
  }
  return out;
}

describe("the two syntax references", () => {
  it("are comparable in size as given to the model", () => {
    const oldText = referenceText(oldDoc);
    const newText = newReference();
    expect(oldText.startsWith("# Syntax")).toBe(true);
    expect(newText.startsWith("# Syntax")).toBe(true);
    const ratio = oldText.length / newText.length;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  it("keep the vendored copy's MIT attribution", () => {
    expect(oldDoc).toContain("MIT License. Copyright (c) 2026 Magnus Haggren.");
  });
});

describe.skipIf(!hasBaseline)("the old reference, against the baseline parser", () => {
  let core: BaselineCore;
  beforeAll(async () => {
    core = await loadBaseline();
  }, 60_000);
  const errors = (source: string, base?: string) =>
    core.resolve(source, { lookup: (id) => (id === "base" ? base : undefined) }).errors;

  it("has examples that all parse clean", () => {
    const examples = blocks(oldDoc, "text");
    expect(examples.length).toBeGreaterThanOrEqual(8);
    for (const example of examples) expect(errors(example), example).toEqual([]);
    expect(blocks(oldDoc, "wiredown")).toHaveLength(2);
    expect(checkWithBaseline(core, oldDoc)).toMatchObject({ ids: ["base", "updated"], errors: [] });
  });

  it("describes ids, comments and highlights as the baseline has them", () => {
    const tree = core.resolve("button: *Invite (id=invite, w=120)").tree;
    expect(tree.children[0]).toMatchObject({ id: "invite", text: "*Invite" });
    expect(errors("text: A (id=x)\ntext: B (id=x)")).toEqual([
      { line: 2, message: 'the id "x" is used twice' },
    ]);
    expect(
      errors("box: A\n  // a note\n  button: Cancel (hi)\ngrid\nA | B\n> 1 | 2\n>* 3 | 4"),
    ).toEqual([]);
  });

  it("describes variants as the baseline resolves them", () => {
    const base =
      "window: Members (id=win)\n  text: Anna (id=anna)\n  grid (id=g)\n  Name | Role\n  Anna | Admin";
    // a bare container line keeps the base's children
    const kept = core.resolve("extends: base\nwindow: Team (id=win, w=640)", {
      lookup: () => base,
    });
    expect(kept.errors).toEqual([]);
    expect(kept.tree.children[0]).toMatchObject({ text: "Team" });
    expect(kept.tree.children[0].children).toHaveLength(2);
    // = keeps a cell; a new key is added at the end
    const rows = core.resolve("extends: base\nrows: g\n  Anna | =\n  Erik | Member", {
      lookup: () => base,
    });
    expect(rows.errors).toEqual([]);
    expect(rows.tree.children[0].children[1].body).toEqual(["Anna | Admin", "Erik | Member"]);
    // a component line without an id is an error that lists the base's ids
    expect(errors("extends: base\ntext: New", base)[0].message).toBe(
      'in a variant, "text:" needs the (id=...) of the component it replaces, or a place under ' +
        '"after: <id>" or "before: <id>"; ids in "base": win, anna, g',
    );
    expect(errors("extends: base\nremove: anna, g", base)).toEqual([]);
  });
});

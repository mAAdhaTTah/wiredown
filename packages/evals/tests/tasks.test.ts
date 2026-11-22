import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillReference } from "../src/check";
import { readConfig } from "../src/config";
import { DEFAULT_MATERIAL, loadMaterial } from "../src/material";
import { TASKS } from "../src/tasks";

describe("material", () => {
  it("loads the fixture PRD and the task inputs", () => {
    const m = loadMaterial();
    expect(m.screens.map((s) => s.id)).toHaveLength(5);
    expect(m.prd).toContain("Scheduled report exports");
    expect(m.variantBase).toContain("^exports-list");
    expect(m.reviewInput).toContain("grid #exports");
  });

  it("takes a PRD file, with the material next to it", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiredown-material-"));
    try {
      cpSync(DEFAULT_MATERIAL, dir, { recursive: true });
      writeFileSync(join(dir, "real.md"), "# A real PRD\n");
      const m = loadMaterial(join(dir, "real.md"));
      expect(m.prd).toBe("# A real PRD\n");
      expect(m.dir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prompts", () => {
  const m = loadMaterial();
  it("give the skill's reference, the file format, the task and the reply format", () => {
    for (const task of TASKS) {
      const p = task.prompt(m);
      expect(p).toContain(
        "<syntax-reference>\n" + skillReference().trimEnd() + "\n</syntax-reference>",
      );
      expect(p).toContain("^greeting");
      expect(p).toContain("four backticks");
    }
    expect(TASKS[0].prompt(m)).toContain("- ^export-failed: ");
    expect(TASKS[1].prompt(m)).toContain(m.variant.change);
    expect(TASKS[2].prompt(m)).toContain(m.review.comment);
  });

  it("never mention this repository's skill", () => {
    for (const task of TASKS) expect(task.prompt(m)).not.toMatch(/SKILL\.md|wiredown render/);
  });
});

describe("readConfig", () => {
  it("has small defaults and validates numbers", () => {
    expect(readConfig({})).toMatchObject({ model: "sonnet", runs: 2, cap: 3, concurrency: 2 });
    expect(readConfig({ WIREDOWN_EVAL_MODEL: "haiku", WIREDOWN_EVAL_CAP: "0" })).toMatchObject({
      model: "haiku",
      cap: 0,
    });
    expect(() => readConfig({ WIREDOWN_EVAL_RUNS: "0" })).toThrow(
      'WIREDOWN_EVAL_RUNS must be a whole number of at least 1, not "0"',
    );
  });
});

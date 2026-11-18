import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newArm } from "../src/arms.ts";
import { readConfig } from "../src/config.ts";
import { DEFAULT_MATERIAL, loadMaterial } from "../src/material.ts";
import { TASKS } from "../src/tasks.ts";

describe("material", () => {
  it("loads the fixture PRD and per-arm inputs", () => {
    const m = loadMaterial();
    expect(m.screens.map((s) => s.id)).toHaveLength(5);
    expect(m.prd).toContain("Scheduled report exports");
    expect(m.inputs.old.review).toContain("(id=exports)");
    expect(m.inputs.new.review).toContain("grid #exports");
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
  const arm = newArm();
  it("give the arm's reference, the file format, the task and the reply format", () => {
    for (const task of TASKS) {
      const p = task.prompt(m, arm);
      expect(p).toContain("<syntax-reference>\n# Syntax");
      expect(p).toContain("^greeting");
      expect(p).toContain("four backticks");
    }
    expect(TASKS[0].prompt(m, arm)).toContain("- ^export-failed: ");
    expect(TASKS[1].prompt(m, arm)).toContain(m.variant.change);
    expect(TASKS[2].prompt(m, arm)).toContain(m.review.comment);
  });

  it("never mention this repository's skill", () => {
    for (const task of TASKS) expect(task.prompt(m, arm)).not.toMatch(/SKILL\.md|wiredown render/);
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

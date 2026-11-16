import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ARMS, checkWithBaseline, formatFindings, loadArms, newArm } from "../src/arms.ts";
import type { Arm, ArmName } from "../src/arms.ts";
import { loadBaseline } from "../src/baseline.ts";
import { loadMaterial } from "../src/material.ts";
import { hasBaseline, screen } from "./helpers.ts";

// The fork's syntax before the proposal: (id=…), (hi), implicit replacement.
const OLD_FILE =
  screen("exports", [
    "window: Exports",
    "  // the header",
    "  row:",
    "    h2: Scheduled exports",
    "    button: *New export (id=new, hi)",
    "  text: 3 of 5 used (id=usage)",
    "  grid (id=list)",
    "  Name | Status",
    "  Weekly revenue | Active",
    "  > Churn | Failed",
  ]) +
  "\n" +
  screen("exports-paused", [
    "extends: exports",
    "text: 3 of 5 used, 1 paused (id=usage)",
    "rows: list",
    "  Weekly revenue | Paused",
  ]);

// After it: #id, (focus), replace:.
const NEW_FILE =
  screen("exports", [
    "window: Exports",
    "  row:",
    "    h2: Scheduled exports",
    "    button: *New export #new (focus)",
    "  text: 3 of 5 used #usage",
    "  grid #list",
    "  Name | Status",
    "  Weekly revenue | Active",
  ]) +
  "\n" +
  screen("exports-paused", [
    "extends: exports",
    "replace: usage",
    "  text: 3 of 5 used, 1 paused",
    "rows: list",
    "  Weekly revenue | Paused",
  ]);

describe("the new arm", () => {
  it("rejects the old syntax: (hi) and implicit replacement", () => {
    const { errors } = newArm().check(OLD_FILE);
    const messages = errors.map((e) => e.message);
    expect(messages).toContain('unknown option "hi"; did you mean "h"?');
    expect(messages.some((m) => m.startsWith("in a variant, say what this does"))).toBe(true);
  });

  it("accepts the new syntax", () => {
    expect(newArm().check(NEW_FILE)).toEqual({
      ids: ["exports", "exports-paused"],
      errors: [],
      warnings: [],
    });
  });
});

describe.skipIf(!hasBaseline)("the old arm (baseline parser)", () => {
  let arms: Record<ArmName, Arm>;
  beforeAll(async () => {
    arms = await loadArms();
  }, 60_000);

  it("accepts the old syntax", () => {
    expect(arms.old.check(OLD_FILE)).toEqual({
      ids: ["exports", "exports-paused"],
      errors: [],
      warnings: [],
    });
  });

  it("rejects the new syntax's replace:, reporting per screen at file lines", () => {
    const { errors } = arms.old.check(NEW_FILE);
    expect(errors[0]).toEqual({
      line: 20,
      message: 'don\'t understand "replace: usage"',
      screen: "exports-paused",
    });
    // #id is plain text there, so the base has no ids to target
    expect(errors.map((e) => e.message)).toContain(
      'rows: "exports" has no component with (id=list); its ids are: (none)',
    );
  });

  // Blocks valid in both syntaxes, so file-level problems are the only findings.
  const ok = (id: string | null, text = "text: A") =>
    ["## S", "", "```wiredown", text, "```", "", ...(id === null ? [] : [id]), ""].join("\n");
  const unclosed = "```wiredown\ntext: C\n";
  const parity: [string, string][] = [
    ["no id", ok("^a") + ok(null)],
    ["invalid id", ok("^a") + ok("^not valid!")],
    ["duplicate ids", ok("^a") + ok("^b") + ok("^a")],
    ["unclosed fence after valid blocks", ok("^a") + ok("^b") + unclosed],
    ["duplicate ids, then an unclosed fence", ok("^a") + ok("^a") + unclosed],
    [
      "no id, invalid and duplicate ids, unclosed",
      ok(null) + ok("^x y") + ok("^a") + ok("^a") + unclosed,
    ],
    ["a variant of a duplicated id", ok("^a") + ok("^a", "text: B") + ok("^v", "extends: a")],
  ];

  it.for(parity)("reports file-level problems exactly as the new arm: %s", ([, file]) => {
    const neu = arms.new.check(file);
    expect(neu.errors.length + neu.warnings.length).toBeGreaterThan(0);
    expect(arms.old.check(file)).toEqual(neu);
  });

  it("keeps the findings of complete blocks before an unclosed fence", () => {
    const report = arms.old.check(ok("^a") + ok("^a") + unclosed);
    expect(report.errors.map((e) => [e.line, e.message])).toEqual([
      [15, "unclosed code fence"],
      [14, 'duplicate block id "a"; first used on line 7'],
    ]);
  });

  it("checks the material's inputs clean in their own syntax", () => {
    const material = loadMaterial();
    for (const arm of ARMS) {
      expect(arms[arm].check(material.inputs[arm].variantBase).errors).toEqual([]);
      expect(arms[arm].check(material.inputs[arm].review).errors).toEqual([]);
    }
  });

  it("builds the baseline from git into a fresh cache directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wiredown-baseline-"));
    try {
      const core = await loadBaseline(join(dir, "baseline"));
      expect(checkWithBaseline(core, OLD_FILE).errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("formatFindings", () => {
  it("prints findings like wiredown check, in line order", () => {
    const text = formatFindings("screens.md", {
      ids: [],
      errors: [{ line: 9, message: "bad", screen: "b" }],
      warnings: [{ line: 3, message: "meh" }],
    });
    expect(text).toBe("screens.md:3: warning: meh\nscreens.md:9: ^b: error: bad\n");
  });
});

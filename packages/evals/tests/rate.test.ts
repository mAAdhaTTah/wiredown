import { describe, expect, it } from "vitest";
import { ratingSheet, seeded, tally } from "../src/rate.ts";
import type { RatingCase } from "../src/rate.ts";

const cases: RatingCase[] = Array.from({ length: 12 }, (_, i) => ({
  title: `task 2, run ${i + 1}`,
  request: "pause an export",
  outputs: {
    new: { input: "x\n", file: `x\nNEW-${i}\n` },
    old: { input: "x\n", file: i === 0 ? null : `x\nOLD-${i}\n` },
  },
}));

describe("ratingSheet", () => {
  it("is reproducible from its seed", () => {
    expect(ratingSheet(cases, "s1")).toEqual(ratingSheet(cases, "s1"));
    const order = (seed: string) => ratingSheet(cases, seed).key.cases.map((c) => c.A);
    expect(order("s1")).not.toEqual(order("s2"));
    expect(seeded("s1")()).toBe(seeded("s1")());
  });

  it("shows each arm as a diff under the letter its key gives it", () => {
    const { sheet, key } = ratingSheet(cases, "seed");
    expect(key.seed).toBe("seed");
    expect(new Set(key.cases.map((c) => c.A))).toEqual(new Set(["new", "old"]));
    for (const c of key.cases.slice(1)) {
      const section = sheet.split(`## Case ${c.case}:`)[1].split("## Case")[0];
      const [a, b] = section.split("### B");
      expect(a).toContain(`+${c.A.toUpperCase()}-${c.case - 1}`);
      expect(b).toContain(`+${c.B.toUpperCase()}-${c.case - 1}`);
      expect(section).toContain(`Case ${c.case}, more readable (A / B / same):`);
    }
    expect(sheet).toContain("_(no usable output)_");
    // a diff of a file with ``` fences gets a longer fence of its own
    const fenced = ratingSheet(
      [
        {
          ...cases[1],
          outputs: { ...cases[1].outputs, new: { input: "", file: "```wiredown\nx\n```\n" } },
        },
      ],
      "seed",
    ).sheet;
    expect(fenced).toContain("````diff\n--- before\n+++ after\n@@ -0,0 +1,3 @@\n+```wiredown\n");
    // the sheet itself never names the arms
    expect(sheet).not.toMatch(/\b(old|new) arm\b|"(old|new)"/);
  });
});

describe("tally", () => {
  it("counts answers per arm through the key", () => {
    const { sheet, key } = ratingSheet(cases.slice(0, 3), "seed");
    const filled = sheet
      .replace("Case 1, more readable (A / B / same):", "Case 1, more readable (A / B / same): A")
      .replace(
        "Case 2, more readable (A / B / same):",
        "Case 2, more readable (A / B / same): same",
      );
    const result = tally(filled, key);
    expect(result).toEqual({
      new: key.cases[0].A === "new" ? 1 : 0,
      old: key.cases[0].A === "old" ? 1 : 0,
      same: 1,
      unanswered: [3],
    });
  });
});

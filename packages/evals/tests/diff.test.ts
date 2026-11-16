import { describe, expect, it } from "vitest";
import { diffLines, diffSize, lineCount, unifiedDiff } from "../src/diff.ts";

describe("diff", () => {
  const before = ["a", "b", "c", "", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
  const after = ["a", "B", "c", "", "d", "e", "f", "g", "h", "i", "j", "", "k"].join("\n") + "\n";

  it("counts added and removed non-blank lines", () => {
    expect(diffSize(before, after)).toBe(3); // -b +B +k; the added blank line is not counted
    expect(diffSize(before, before)).toBe(0);
    expect(diffSize("", "x\ny\n")).toBe(2);
  });

  it("diffs lines in order", () => {
    expect(diffLines("a\nb\n", "a\nc\n")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "c" },
    ]);
  });

  it("writes a unified diff with separate hunks for distant changes", () => {
    expect(unifiedDiff(before, after, { from: "old", to: "new" })).toBe(
      [
        "--- old",
        "+++ new",
        "@@ -1,5 +1,5 @@",
        " a",
        "-b",
        "+B",
        " c",
        " ",
        " d",
        "@@ -9,3 +9,5 @@",
        " h",
        " i",
        " j",
        "+",
        "+k",
        "",
      ].join("\n"),
    );
    expect(unifiedDiff(before, before)).toBe("");
  });

  it("diffs against an empty file", () => {
    expect(unifiedDiff("", "x\n")).toBe("--- a\n+++ b\n@@ -0,0 +1,1 @@\n+x\n");
  });

  it("counts non-blank lines", () => {
    expect(lineCount("a\n\n  \nb\n")).toBe(2);
  });
});

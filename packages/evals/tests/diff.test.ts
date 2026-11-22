import { describe, expect, it } from "vitest";
import { diffSize, lineCount } from "../src/diff";

describe("diff", () => {
  const before = ["a", "b", "c", "", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
  const after = ["a", "B", "c", "", "d", "e", "f", "g", "h", "i", "j", "", "k"].join("\n") + "\n";

  it("counts added and removed non-blank lines", () => {
    expect(diffSize(before, after)).toBe(3); // -b +B +k; the added blank line is not counted
    expect(diffSize(before, before)).toBe(0);
    expect(diffSize("", "x\ny\n")).toBe(2);
  });

  it("counts non-blank lines", () => {
    expect(lineCount("a\n\n  \nb\n")).toBe(2);
  });
});

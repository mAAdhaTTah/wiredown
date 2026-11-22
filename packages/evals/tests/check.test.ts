import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFile, formatFindings, skillReference } from "../src/check";
import { loadMaterial } from "../src/material";
import { REPO } from "../src/paths";
import { screen } from "./helpers";

const FILE =
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

describe("checkFile", () => {
  it("accepts the current syntax", () => {
    expect(checkFile(FILE)).toEqual({
      ids: ["exports", "exports-paused"],
      errors: [],
      warnings: [],
    });
  });

  it("reports errors per screen at file lines", () => {
    const { errors } = checkFile(FILE.replace("replace: usage\n  ", ""));
    expect(errors[0]).toMatchObject({ screen: "exports-paused", line: 20 });
    expect(errors[0].message).toContain("in a variant needs a command");
  });

  it("checks the material's inputs clean", () => {
    const material = loadMaterial();
    expect(checkFile(material.variantBase).errors).toEqual([]);
    expect(checkFile(material.reviewInput).errors).toEqual([]);
  });
});

describe("skillReference", () => {
  it("is syntax.md, then each component file, without the generated-file notes", () => {
    const text = skillReference();
    expect(text.startsWith("# Syntax\n")).toBe(true);
    expect(text).not.toContain("<!--");
    for (const name of ["content", "data", "inputs", "layout", "variants"]) {
      const file = readFileSync(`${REPO}skills/wiredown/reference/components/${name}.md`, "utf8");
      expect(text).toContain(file.split("\n").find((l) => l.startsWith("# ")));
    }
  });
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

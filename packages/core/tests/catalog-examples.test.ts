import { expect, it } from "vitest";
import { CATALOG, check, parse } from "../src/index.js";
import type { SpecNode } from "../src/index.js";

const hasType = (node: SpecNode, type: string): boolean =>
  node.type === type || node.children.some((child) => hasType(child, type));

it.each(CATALOG)("checks the $type catalog example", (entry) => {
  const base =
    entry.type === "rows"
      ? "grid #target\nName | Status\nAnna | Invited"
      : "text: Original #target";
  const result = check(entry.example, { lookup: (id) => (id === "base" ? base : undefined) });
  expect(result.errors).toEqual([]);
  expect(result.warnings).toEqual([]);
  // Directives are consumed by resolution; confirm their parsed type too.
  expect(hasType(parse(entry.example).tree, entry.type)).toBe(true);
  if (!entry.directive) expect(hasType(result.tree, entry.type)).toBe(true);
});

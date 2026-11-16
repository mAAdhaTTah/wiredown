// @vitest-environment node
import { readFileSync, statSync } from "node:fs";
import { expect, it } from "vitest";
it("ships a small browser bundle with external Obsidian and install files", () => {
  const file = new URL("../dist/main.js", import.meta.url);
  const text = readFileSync(file, "utf8");
  for (const name of ["manifest.json", "styles.css"])
    expect(statSync(new URL(`../dist/${name}`, import.meta.url)).size).toBeGreaterThan(0);
  expect(text).toContain('require("obsidian")');
  expect(text).not.toMatch(/happy-dom|@excalidraw\/utils|["']node:/);
  const size = statSync(file).size;
  console.log(`Obsidian bundle: ${size} bytes`);
  expect(size).toBeLessThan(300_000);
});

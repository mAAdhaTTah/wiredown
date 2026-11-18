// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { expect, it } from "vitest";

const dist = new URL("../dist/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, dist), "utf8");
const scripts = [
  "wiredown.js",
  "wiredown-renderer.js",
  ...readdirSync(new URL("chunks/", dist)).map((f) => `chunks/${f}`),
];

it("builds a small loader with no Excalidraw or React in it", () => {
  const loader = read("wiredown.js");
  const size = statSync(new URL("wiredown.js", dist)).size;
  console.log(`loader: ${size} bytes`);
  expect(size).toBeLessThan(5_000);
  expect(loader).not.toMatch(/react|svg-source|roughjs|exportToSvg|EXCALIDRAW_ASSET_PATH/i);
  // A classic script: no static imports, one dynamic import of the renderer.
  expect(loader).not.toMatch(/^import |\bexport\s*\{/m);
  expect(loader.match(/\bimport\(/g)).toHaveLength(1);
  expect(loader).toContain('"wiredown-renderer.js"');
});

it("builds a renderer that imports Excalidraw, with its font next to it", () => {
  const renderer = read("wiredown-renderer.js");
  expect(renderer).toMatch(/import\("\.\/chunks\/[^"]+\.js"\)/);
  expect(renderer).toMatch(/export\s*\{[^}]*\brender\b/);
  expect(scripts.some((f) => read(f).includes("svg-source:excalidraw"))).toBe(true);
  expect(readdirSync(new URL("fonts/Excalifont/", dist)).length).toBeGreaterThan(0);
});

it("ships no Node code and no font fallback to another origin", () => {
  for (const file of scripts)
    expect(read(file), file).not.toMatch(
      /["']node:|happy-dom|resvg|woff2-encoder|wiredown-fonts-|@excalidraw\/utils|@wiredown\/excalidraw\/node|esm\.sh/,
    );
});

it("ships only Excalifont, with its licence", () => {
  expect(readdirSync(new URL("fonts/", dist))).toEqual(["Excalifont"]);
  const files = readdirSync(new URL("fonts/Excalifont/", dist));
  expect(files.filter((f) => !f.endsWith(".woff2"))).toEqual(["OFL.txt"]);
  expect(read("fonts/Excalifont/OFL.txt")).toContain("SIL OPEN FONT LICENSE Version 1.1");
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { layoutScreen, parse } from "@wiredown/core";
import { beforeAll, describe, expect, it } from "vitest";
import { screenElements } from "../src/index.js";
import { renderScreenSvg, renderSvg } from "../src/node.js";

// Use the actual proposal so this fixture cannot silently diverge from it.
const proposal = readFileSync(
  new URL("../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
  "utf8",
);
const source = proposal.split("```wiredown\n")[1].split("\n```")[0];
const tree = parse(source).tree;
const screen = screenElements(layoutScreen(tree));
let svg: string;

beforeAll(async () => {
  svg = await renderSvg(screen.elements);
}, 15000);

describe("Node SVG export", () => {
  it("exports the running example at the adapter's size with text and Excalifont", () => {
    expect(svg).toContain("<svg");
    expect(svg).toContain(`width="${screen.width}"`);
    expect(svg).toContain(`height="${screen.height}"`);
    expect(svg).toContain("Team settings");
    expect(svg).toContain("anna@example.com");
    expect(svg).toMatch(/@font-face[\s\S]*font-family:\s*Excalifont/);
    expect(svg).toContain("data:font/woff2;base64,");
  });

  it("can omit embedded fonts", async () => {
    expect(await renderSvg(screen.elements, { fonts: false })).not.toContain("@font-face");
  });

  it("lets Excalidraw render dark mode", async () => {
    const dark = await renderSvg(screen.elements, { theme: "dark" });
    expect(dark).not.toBe(svg);
    expect(dark).toContain("Team settings");
  });

  it("is byte-identical on repeat and concurrent exports", async () => {
    const copies = await Promise.all([renderSvg(screen.elements), renderSvg(screen.elements)]);
    expect(copies).toEqual([svg, svg]);
  });

  it("is byte-identical in two fresh Node processes", () => {
    const script = `
      import { renderSvg } from "@wiredown/excalidraw/node";
      const elements = JSON.parse(process.argv[1]);
      process.stdout.write(await renderSvg(elements));
    `;
    const run = () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script, JSON.stringify(screen.elements)],
        {
          cwd: new URL("..", import.meta.url),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    expect(run()).toBe(svg);
    expect(run()).toBe(svg);
  }, 15000);

  it("returns layout dimensions and boxes for the CLI convenience", async () => {
    expect(await renderScreenSvg(tree)).toEqual({
      svg,
      width: screen.width,
      height: screen.height,
      boxes: screen.boxes,
    });
  });

  it("exports an empty screen without throwing", async () => {
    const empty = screenElements({ ops: [], size: { w: 0, h: 0 }, boxes: {} });
    expect(await renderSvg(empty.elements)).toContain("<svg");
  });
});

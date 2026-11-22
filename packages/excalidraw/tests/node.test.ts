import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { layoutScreen, parse } from "@wiredown/core";
import { beforeAll, describe, expect, it } from "vitest";
import { screenElements } from "../src/index";
import { renderScreenSvg } from "../src/node";

// Use the actual proposal so this fixture cannot silently diverge from it.
const proposal = readFileSync(
  new URL("../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
  "utf8",
);
const source = proposal.split("```wiredown\n")[1].split("\n```")[0];
const tree = parse(source).tree;
const screen = screenElements(layoutScreen(tree));
const svgOf = async (options?: Parameters<typeof renderScreenSvg>[1]) =>
  (await renderScreenSvg(tree, options)).svg;
let svg: string;

// Runs the built entry in a fresh Node process, as a consumer would.
const runNode = (...args: string[]) =>
  execFileSync(process.execPath, [...args, JSON.stringify(tree)], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

beforeAll(async () => {
  svg = await svgOf();
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
    expect(await svgOf({ fonts: false })).not.toContain("@font-face");
  });

  it("lets Excalidraw render dark mode", async () => {
    const dark = await svgOf({ theme: "dark" });
    expect(dark).not.toBe(svg);
    expect(dark).toContain("Team settings");
  });

  it("is byte-identical on repeat and concurrent exports", async () => {
    const copies = await Promise.all([svgOf(), svgOf()]);
    expect(copies).toEqual([svg, svg]);
  });

  it("is byte-identical in two fresh Node processes", () => {
    const script = `
      import { renderScreenSvg } from "@wiredown/excalidraw/node";
      const tree = JSON.parse(process.argv[1]);
      process.stdout.write((await renderScreenSvg(tree)).svg);
    `;
    expect(runNode("--input-type=module", "-e", script)).toBe(svg);
    expect(runNode("--input-type=module", "-e", script)).toBe(svg);
  }, 15000);

  it("can be required from CommonJS", () => {
    // A file, not `node -e`: -e defines a global __dirname, which changes how
    // Excalidraw embeds the font.
    expect(runNode(fileURLToPath(new URL("require.cjs", import.meta.url)))).toBe(svg);
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
    expect((await renderScreenSvg(parse("").tree)).svg).toContain("<svg");
  });
});

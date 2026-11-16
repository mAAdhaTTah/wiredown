import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { layoutScreen, parse } from "@wiredown/core";
import { addScreen, embedSize, newFlow, screenElements } from "../src/index.js";
import { BACKGROUND, FLOW_MARGIN, renderFlowSvg, renderSvg, svgToPng } from "../src/node.js";
import { decodePng } from "./png.js";

const proposal = readFileSync(
  new URL("../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
  "utf8",
);
const screen = screenElements(
  layoutScreen(parse(proposal.split("```wiredown\n")[1].split("\n```")[0]).tree),
);
let svg: string;
let opaque: Awaited<ReturnType<typeof svgToPng>>;

beforeAll(async () => {
  svg = await renderSvg(screen.elements);
  opaque = await svgToPng(svg, { scale: 2, background: BACKGROUND.light });
}, 30000);

describe("svgToPng", { timeout: 30000 }, () => {
  it("writes a PNG at the SVG size times the scale, the same bytes every time", async () => {
    const png = Buffer.from(opaque.png);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString("latin1", 12, 16)).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      screen.width * 2,
      screen.height * 2,
    ]);
    expect([opaque.width, opaque.height]).toEqual([screen.width * 2, screen.height * 2]);
    const again = await svgToPng(svg, { scale: 2, background: BACKGROUND.light });
    expect(Buffer.from(again.png).equals(png)).toBe(true);
    const small = await svgToPng(svg);
    expect([small.width, small.height]).toEqual([screen.width, screen.height]);
    await expect(svgToPng(svg, { scale: 0 })).rejects.toThrow(RangeError);
  });

  it("is transparent unless given a background", async () => {
    expect(decodePng(opaque.png).pixel(0, 0)).toEqual([255, 255, 255, 255]);
    const clear = await svgToPng(svg, { scale: 2 });
    expect(decodePng(clear.png).pixel(0, 0)[3]).toBe(0);
    const dark = await svgToPng(await renderSvg(screen.elements, { theme: "dark" }), {
      background: BACKGROUND.dark,
    });
    expect(decodePng(dark.png).pixel(0, 0)).toEqual([0x12, 0x12, 0x12, 255]);
  });

  // resvg ignores @font-face, so the font must reach it another way. Without
  // it, text falls back to a system font (or draws nothing) and the pixels are
  // exactly those of the same SVG exported without its font.
  it("draws text in the Excalifont the SVG embeds", async () => {
    const fallback = await svgToPng(await renderSvg(screen.elements, { fonts: false }), {
      scale: 2,
      background: BACKGROUND.light,
    });
    expect(Buffer.from(fallback.png).equals(Buffer.from(opaque.png))).toBe(false);
  });

  // A flow's screens are SVG images; a pixel-exact match with the screen
  // rendered alone shows they are placed, sized and drawn with their font.
  it("draws a flow's screen images like the screens themselves", async () => {
    const flow = newFlow();
    addScreen(flow, { screenId: "s", title: "s", path: "screens", size: screen });
    flow.elements = flow.elements.filter((e) => e.type === "image");
    const rendered = await renderFlowSvg(flow, () => screen.elements);
    const pad = (embedSize(screen.width, screen.height).image.width - screen.width) / 2;
    const whole = decodePng(
      (await svgToPng(rendered.svg, { background: "#fff", inline: rendered.inline })).png,
    );
    const alone = decodePng((await svgToPng(svg, { background: "#fff" })).png);
    // Nested rendering rounds a few edge pixels by one step.
    let worst = 0;
    for (let y = 0; y < alone.height; y++)
      for (let x = 0; x < alone.width; x++) {
        const [a, b] = [whole.pixel(x + pad + FLOW_MARGIN, y + FLOW_MARGIN), alone.pixel(x, y)];
        for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(a[c] - b[c]));
      }
    expect(worst).toBeLessThanOrEqual(2);
    // Inlined, a screen's links would be followed: it must have none.
    const [image] = rendered.inline;
    const inner = Buffer.from(image.split(",")[1], "base64").toString("utf8");
    expect(inner).not.toMatch(/<image/i);
    expect(inner.match(/href\s*=\s*["'](?!#)/gi)).toBeNull();
  });
});

// A drawing may carry an SVG image linking to a local file, which resvg would
// read if the SVG were inlined. Only wiredown's own screens are inlined.
it("does not draw a local file that a drawing's SVG image links to", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "wiredown-png-"));
  try {
    const red = join(dir, "red.png");
    const box = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">';
    await writeFile(
      red,
      (await svgToPng(`${box}<rect width="20" height="20" fill="red"/></svg>`)).png,
    );
    // resvg itself draws a linked local file
    const direct = await svgToPng(`${box}<image href="${red}" width="20" height="20"/></svg>`);
    expect(decodePng(direct.png).pixel(10, 10)).toEqual([255, 0, 0, 255]);
    const links = [
      `href="${red}"`,
      `href = "${red}"`,
      `href\t=\t"${red}"`,
      `href=\n"${red}"`,
      `xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href='${red}'`,
      `HREF="${red}"`,
    ];
    const drawing = async (inner: string) => {
      const data = Buffer.from(`${box}${inner}</svg>`).toString("base64");
      const outer =
        `${box}<symbol id="s"><image href="data:image/svg+xml;base64,${data}" width="100%" height="100%">` +
        `</image></symbol><use href="#s" width="20" height="20"/></svg>`;
      return decodePng((await svgToPng(outer, { background: "#ffffff" })).png);
    };
    // the drawing's SVG image is drawn, just not its link
    expect((await drawing('<rect width="20" height="20" fill="red"/>')).pixel(10, 10)).toEqual([
      255, 0, 0, 255,
    ]);
    for (const link of links) {
      const pixels = await drawing(`<image ${link} width="20" height="20"/>`);
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 20; x++) {
          const [r, g, b] = pixels.pixel(x, y);
          expect(r > 200 && g < 100 && b < 100, `${link} at ${x},${y}`).toBe(false);
        }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

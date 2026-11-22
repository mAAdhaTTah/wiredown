import { readFileSync } from "node:fs";
import { layoutScreen, parse } from "@wiredown/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCREEN_INSET } from "../src/flow-edit";
import { FLOW_MARGIN } from "../src/flow-render";
import { addScreen, newFlow, screenElements } from "../src/index";
import { BACKGROUND, renderFlowSvg, renderScreenSvg, svgToPng } from "../src/node";
import { decodePng } from "./png";

const proposal = readFileSync(
  new URL("../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
  "utf8",
);
const tree = parse(proposal.split("```wiredown\n")[1].split("\n```")[0]).tree;
const screen = screenElements(layoutScreen(tree));
const svgOf = async (options?: Parameters<typeof renderScreenSvg>[1]) =>
  (await renderScreenSvg(tree, options)).svg;
let svg: string;
let opaque: Awaited<ReturnType<typeof svgToPng>>;

beforeAll(async () => {
  svg = await svgOf();
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
    const dark = await svgToPng(await svgOf({ theme: "dark" }), {
      background: BACKGROUND.dark,
    });
    expect(decodePng(dark.png).pixel(0, 0)).toEqual([0x12, 0x12, 0x12, 255]);
  });

  // resvg ignores @font-face, so the font must reach it another way. Without
  // it, text falls back to a system font (or draws nothing) and the pixels are
  // exactly those of the same SVG exported without its font.
  it("draws text in the Excalifont the SVG embeds", async () => {
    const fallback = await svgToPng(await svgOf({ fonts: false }), {
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
    const whole = decodePng(
      (await svgToPng(rendered.svg, { background: "#fff", inline: rendered.inline })).png,
    );
    const alone = decodePng((await svgToPng(svg, { background: "#fff" })).png);
    // Nested rendering rounds a few edge pixels by one step.
    let worst = 0;
    for (let y = 0; y < alone.height; y++)
      for (let x = 0; x < alone.width; x++) {
        const [a, b] = [
          whole.pixel(x + SCREEN_INSET.x + FLOW_MARGIN, y + SCREEN_INSET.y + FLOW_MARGIN),
          alone.pixel(x, y),
        ];
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

// An SVG document can make resvg read a local file in many ways (an image,
// an feImage, a pattern's image), so a drawing's SVG images never reach it:
// a PNG flow render rejects them, and svgToPng refuses any it is handed.
describe("local files linked from a drawing's SVG images", { timeout: 30000 }, () => {
  let dir: string;
  let red: string;
  let flowWith: (dataURL: string) => ReturnType<typeof newFlow>;
  const box = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">';
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  const redPixels = (png: Uint8Array) => {
    const image = decodePng(png);
    let count = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const [r, g, b] = image.pixel(x, y);
        if (r > 200 && g < 100 && b < 100) count++;
      }
    return count;
  };
  const symbol = (href: string) =>
    `${box}<symbol id="s"><image href="${href}" width="100%" height="100%"></image></symbol>` +
    `<use href="#s" width="20" height="20"/></svg>`;
  const REFUSED = "svgToPng: refusing an SVG image that is not one of the trusted screens";
  let probes: Record<string, string>;

  beforeAll(async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    dir = await mkdtemp(join(tmpdir(), "wiredown-png-"));
    red = join(dir, "red.png");
    await writeFile(
      red,
      (await svgToPng(`${box}<rect width="20" height="20" fill="red"/></svg>`)).png,
    );
    const redSvg = join(dir, "red.svg");
    await writeFile(
      redSvg,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="20" height="20" fill="red"/></svg>',
    );
    const image = (link: string) => `${box}<image ${link} width="20" height="20"/></svg>`;
    probes = {
      feImage: `${box}<filter id="f" x="0" y="0" width="1" height="1"><feImage href="${red}"/></filter><rect width="20" height="20" filter="url(#f)"/></svg>`,
      pattern: `${box}<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><image href="${red}" width="20" height="20"/></pattern><rect width="20" height="20" fill="url(#p)"/></svg>`,
      use: `${box}<use href="${redSvg}#a"/></svg>`,
      href: image(`href="${red}"`),
      spaces: image(`href = "${red}"`),
      tabs: image(`href\t=\t"${red}"`),
      newline: image(`href=\n"${red}"`),
      xlink: image(`xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href='${red}'`),
      upper: image(`HREF="${red}"`),
    };
    flowWith = (dataURL: string) => {
      const flow = newFlow();
      addScreen(flow, { screenId: "x", title: "x", path: "screens", size: screen });
      const element = flow.elements.find((e) => e.type === "image")!;
      flow.embeds.clear();
      flow.files[String(element.fileId)] = { id: element.fileId, dataURL, created: 1 };
      return flow;
    };
  });
  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });

  it("would draw the linked file if such an SVG reached resvg", async () => {
    expect(redPixels((await svgToPng(probes.href)).png)).toBe(400);
    expect(redPixels((await svgToPng(probes.feImage)).png)).toBe(400);
    expect(redPixels((await svgToPng(probes.pattern)).png)).toBe(400);
  });

  it("rejects a drawing's SVG images in a PNG flow render, in any spelling", async () => {
    for (const [name, inner] of Object.entries(probes))
      for (const dataURL of [
        `data:image/svg+xml;base64,${b64(inner)}`,
        `data:IMAGE/SVG+XML;charset=utf-8;base64,${b64(inner)}`,
        `data:image/svg+xml;utf8,${inner}`,
        `data:image/svg+xml,${encodeURIComponent(inner)}`,
      ]) {
        const flow = flowWith(dataURL);
        const id = Object.keys(flow.files)[0];
        const rendered = await renderFlowSvg(flow, () => undefined, { raster: true });
        expect(rendered.rejected, name).toEqual([
          { id, reason: "SVG images are not drawn in PNG output" },
        ]);
        const { png } = await svgToPng(rendered.svg, { inline: rendered.inline });
        expect(redPixels(png), name).toBe(0);
        // SVG output keeps them, as inert image data
        expect((await renderFlowSvg(flow, () => undefined)).rejected, name).toEqual([]);
      }
  });

  it("refuses to rasterise an SVG image that is not a trusted screen", async () => {
    for (const inner of Object.values(probes))
      await expect(svgToPng(symbol(`data:image/svg+xml;base64,${b64(inner)}`))).rejects.toThrow(
        REFUSED,
      );
    // resvg would sniff these as SVG too, or decode the character reference
    for (const href of [
      `data:text/plain;base64,${b64(probes.feImage)}`,
      `data:;base64,${b64(probes.feImage)}`,
      `data:image/svg&#43;xml;base64,${b64(probes.feImage)}`,
      `&#100;ata:image/svg+xml;base64,${b64(probes.feImage)}`,
      `data:image/svg\n+xml;base64,${b64(probes.feImage)}`,
    ])
      await expect(svgToPng(symbol(href))).rejects.toThrow(REFUSED);
  });

  it("rejects an entity-encoded SVG media type at the scene, which Excalidraw writes verbatim", async () => {
    const dataURL = `data:image/svg&#43;xml;base64,${b64(probes.feImage)}`;
    for (const raster of [true, false])
      expect(
        (await renderFlowSvg(flowWith(dataURL), () => undefined, { raster })).rejected,
      ).toEqual([
        expect.objectContaining({ reason: expect.stringContaining("expected an inline PNG") }),
      ]);
  });

  it("still draws a drawing's raster images in PNG output", async () => {
    const png = Buffer.from(
      (await svgToPng(`${box}<rect width="20" height="20" fill="red"/></svg>`)).png,
    ).toString("base64");
    const rendered = await renderFlowSvg(
      flowWith(`data:image/png;base64,${png}`),
      () => undefined,
      {
        raster: true,
      },
    );
    expect(rendered.rejected).toEqual([]);
    expect(
      redPixels((await svgToPng(rendered.svg, { inline: rendered.inline })).png),
    ).toBeGreaterThan(100);
    // an SVG labelled as PNG is decoded as a PNG, which it is not
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      const labelled = await renderFlowSvg(
        flowWith(`data:${mime};base64,${b64(probes.feImage)}`),
        () => undefined,
        { raster: true },
      );
      expect(redPixels((await svgToPng(labelled.svg, { inline: labelled.inline })).png)).toBe(0);
    }
  });

  it("rejects a drawing's raster images that are not plain base64 in PNG output", async () => {
    for (const dataURL of [
      "data:image/png;base64,AAAAdata:text/plain;base64,AAAA",
      "data:image/png;x=data:image/svg+xml,AAAA;base64,AAAA",
      "data:image/png,AAAA",
    ]) {
      const flow = flowWith(dataURL);
      const id = Object.keys(flow.files)[0];
      const rendered = await renderFlowSvg(flow, () => undefined, { raster: true });
      expect(rendered.rejected, dataURL).toEqual([
        { id, reason: "expected a base64 PNG, JPEG, GIF or WebP data URL" },
      ]);
      // without the rejection, svgToPng would refuse the whole SVG
      await expect(svgToPng(rendered.svg, { inline: rendered.inline })).resolves.toBeDefined();
      expect((await renderFlowSvg(flow, () => undefined)).rejected, dataURL).toEqual([]);
    }
  });
});

it("renders literal data URLs in flow text", async () => {
  const flow = newFlow();
  addScreen(flow, {
    screenId: "s",
    title: "data:text/plain;base64,AAAA",
    path: "screens",
    size: screen,
  });
  const rendered = await renderFlowSvg(flow, () => screen.elements, { raster: true });
  expect(rendered.svg).toContain("data:text/plain;base64,AAAA");
  const result = await svgToPng(rendered.svg, { inline: rendered.inline });
  expect(result.png.length).toBeGreaterThan(0);
});

it("refuses out-of-range character references with the normal error", async () => {
  await expect(
    svgToPng('<svg xmlns="http://www.w3.org/2000/svg"><image href="&#99999999;"/></svg>'),
  ).rejects.toThrow("svgToPng: refusing an SVG image that is not one of the trusted screens");
});

it.each([
  "<style>.x { fill: url(data:text/plain;base64,AAAA); }</style>",
  '<rect style="fill: url(DATA:IMAGE/SVG+XML;base64,AAAA)"/>',
  '<image href="&#100;ata:image/svg+xml;base64,AAAA"/>',
  '<!DOCTYPE svg [<!ENTITY link "data:image/svg+xml;base64,AAAA">]>',
  "<image href='data:image/svg+xml;base64,AAAA'/>",
  '<g id="a>b"/><image href="data:text/plain;base64,AAAA"/>',
  // a quote outside any tag must not hide part of the tag after it
  '<!-- " --><image x="1>2" href="data:image/svg+xml;base64,AAAA"/>',
  '<?p " ?><image x="1>2" href="data:image/svg+xml;base64,AAAA"/>',
  '<![CDATA[ " ]]><image x="1>2" href="data:image/svg+xml;base64,AAAA"/>',
  `<text>it's "</text><image x="1>2" href="data:image/svg+xml;base64,AAAA"/>`,
])("refuses untrusted data URLs in markup and CSS: %s", async (content) => {
  await expect(
    svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">${content}</svg>`),
  ).rejects.toThrow("svgToPng: refusing an SVG image that is not one of the trusted screens");
});

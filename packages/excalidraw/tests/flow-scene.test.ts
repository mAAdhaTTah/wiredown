import { paddedScreenSvg } from "../src/flow-render.js";
import { svgDataUrl } from "../src/flow-render.js";
import { expect, it } from "vitest";
import { addScreen, embedSize, flowScene, newFlow } from "../src/index.js";

it("encodes SVG data URLs as Node's Buffer does, for any text", () => {
  const svg = `<svg width="1" height="1"><text>Grüße ⋯ 日本 ${"x".repeat(70_000)}</text></svg>`;
  expect(svgDataUrl(svg)).toBe("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
});

it("pads a screen SVG to its embed size, centred horizontally", () => {
  const padded = paddedScreenSvg('<svg version="1.1" width="100" height="50"></svg>');
  const { width, height } = embedSize(100, 50).image;
  expect(padded).toBe(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><svg x="${(width - 100) / 2}" y="0" version="1.1" width="100" height="50"></svg></svg>`,
  );
});

it("asks for each embed's screen once and reports the missing ones", async () => {
  const flow = newFlow();
  for (const [id, path] of [
    ["one", "screens"],
    ["missing", "screens"],
    ["one", "screens"],
    ["one", "other"],
  ])
    addScreen(flow, { screenId: id, title: id, path, size: { width: 10, height: 10 } });
  const asked: string[] = [];
  const scene = await flowScene(flow, async ({ path, blockId }) => {
    asked.push(`${path}#^${blockId}`);
    return blockId === "one" ? '<svg width="10" height="10"></svg>' : undefined;
  });
  expect(asked).toEqual(["screens#^one", "screens#^missing", "other#^one"]);
  expect(Object.keys(scene.files)).toHaveLength(3);
  const urls = Object.values(scene.files).map((f) => (f as { dataURL: string }).dataURL);
  expect(scene.inline).toEqual(new Set(urls));
  expect(scene.missing.map((m) => `${m.path}#^${m.blockId}`)).toEqual(["screens#^missing"]);
});

it("retains each allowed drawing image type unchanged", async () => {
  const flow = newFlow();
  for (const type of ["png", "jpeg", "gif", "webp", "svg+xml"]) {
    flow.files[type] = { dataURL: `data:image/${type},content` };
    flow.files[type + "64"] = { dataURL: `DATA:IMAGE/${type.toUpperCase()};base64,YQ==` };
  }
  const scene = await flowScene(flow, async () => undefined);
  expect(scene.files).toEqual(flow.files);
  expect(scene.rejected).toEqual([]);
});

import { readFileSync } from "node:fs";
import { checkScreens, layoutScreen } from "@wiredown/core";
import { beforeAll, expect, it, vi } from "vitest";
import {
  addHighlight,
  addScreen,
  embedSize,
  flowFrames,
  newFlow,
  parseFlow,
  screenElements,
} from "../src/index.js";
import type { ScreenRef } from "../src/index.js";
import { FLOW_MARGIN, renderFlowSvg } from "../src/node.js";

const source = readFileSync(
  new URL("../../core/tests/fixtures/screens.md", import.meta.url),
  "utf8",
);
const checked = checkScreens(source);
const screen = screenElements(layoutScreen(checked.screens[0].tree));
const flow = newFlow();
for (const [id, path] of [
  ["one", "screens"],
  ["missing", "screens"],
  ["one", "screens"],
  ["one", "other"],
])
  addScreen(flow, { screenId: id, title: id, path, size: screen });
// Keep the title at y=0 so export does not translate the scene origin.
for (const element of flow.elements) element.y = Number(element.y) + 48;
addHighlight(flow, "F1", { target: "invite", box: screen.boxes.invite, screen });
const snapshot = () =>
  structuredClone({
    elements: flow.elements,
    files: flow.files,
    appState: flow.appState,
    embeds: [...flow.embeds],
  });
const before = snapshot();
const lookup = vi.fn(({ path, blockId }: ScreenRef) =>
  path === "screens" && blockId === "one" ? screen.elements : undefined,
);
let calls: ScreenRef[][];
let light: Awaited<ReturnType<typeof renderFlowSvg>>;
const urls = (svg: string) =>
  [...svg.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
const decode = (url: string) => Buffer.from(url, "base64").toString();
beforeAll(async () => {
  light = await renderFlowSvg(flow, lookup);
  calls = structuredClone(lookup.mock.calls);
}, 30000);

it("does not mutate scene data or embed entries", () => {
  expect(snapshot()).toEqual(before);
});
it("reports missing embeds and caches screens by path and block id", () => {
  expect(calls).toEqual([
    [{ path: "screens", blockId: "one" }],
    [{ path: "screens", blockId: "missing" }],
    [{ path: "other", blockId: "one" }],
  ]);
  expect(light.missing).toEqual([
    { element: flowFrames(flow)[1].element.id, path: "screens", blockId: "missing" },
    { element: flowFrames(flow)[3].element.id, path: "other", blockId: "one" },
  ]);
});
it("pads the nested canvas and places its screen at x=12, y=2", () => {
  const nested = decode(urls(light.svg)[0]);
  const padded = embedSize(screen.width, screen.height).image;
  expect(padded).toEqual({ width: screen.width + 24, height: screen.height + 9 });
  expect(nested).toContain(
    `width="${padded.width}" height="${padded.height}" viewBox="0 0 ${padded.width} ${padded.height}"`,
  );
  expect(nested).toContain('<svg x="12" y="2"');
});
it("aligns the invite highlight with the nested screen", () => {
  const image = flowFrames(flow)[0].element;
  const box = screen.boxes.invite;
  const group = /<g stroke-linecap="round"[^>]*>/.exec(light.svg)![0];
  const position = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(group)!;
  expect(position).not.toBeNull();
  expect(Number(position[1])).toBeCloseTo(FLOW_MARGIN + Number(image.x) + 10 + box.x - 4);
  expect(Number(position[2])).toBeCloseTo(FLOW_MARGIN + Number(image.y) + box.y - 4);
});
it("filters dark images while preserving light nested bytes", async () => {
  const dark = await renderFlowSvg(flow, lookup, { theme: "dark" });
  expect(dark.svg).toContain('filter="invert(93%) hue-rotate(180deg)"');
  expect(urls(dark.svg)).toEqual(urls(light.svg));
});
it("controls fonts in both outer and nested SVGs", async () => {
  const plain = await renderFlowSvg(flow, lookup, { fonts: false });
  expect(plain.svg).not.toContain("@font-face");
  for (const url of urls(plain.svg)) expect(decode(url)).not.toContain("@font-face");
  expect(light.svg).toContain("@font-face");
  for (const url of urls(light.svg)) expect(decode(url).match(/@font-face/g)).toHaveLength(1);
});
it("renders deterministically", async () => {
  expect(await renderFlowSvg(flow, lookup)).toEqual(light);
});
it("renders zero embeds", async () => {
  const lookup = vi.fn();
  expect((await renderFlowSvg(newFlow(), lookup)).svg).toContain("<svg");
  expect(lookup).not.toHaveBeenCalled();
});
it("skips lookup for deleted embed images", async () => {
  const deleted = newFlow();
  addScreen(deleted, { screenId: "deleted", title: "Deleted", path: "screens", size: screen });
  flowFrames(deleted)[0].element.isDeleted = true;
  const lookup = vi.fn();
  expect((await renderFlowSvg(deleted, lookup)).missing).toEqual([]);
  expect(lookup).not.toHaveBeenCalled();
});
it("passes through an ordinary PNG image unchanged", async () => {
  const ordinary = newFlow();
  addScreen(ordinary, { screenId: "png", title: "PNG", path: "screens", size: screen });
  const image = flowFrames(ordinary)[0].element;
  ordinary.embeds.clear();
  const dataURL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";
  ordinary.files[String(image.fileId)] = {
    id: image.fileId,
    mimeType: "image/png",
    dataURL,
    created: 1,
  };
  const lookup = vi.fn();
  expect((await renderFlowSvg(ordinary, lookup)).svg).toContain(dataURL);
  expect(lookup).not.toHaveBeenCalled();
});
it("exports the real drawing with all three screens missing", async () => {
  const drawing = parseFlow(
    readFileSync(new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url), "utf8"),
  );
  expect((await renderFlowSvg(drawing, () => undefined)).missing).toHaveLength(3);
});

it("keeps only inline image data URLs and reports rejected files", async () => {
  const drawing = newFlow();
  const allowed = ["png", "jpeg", "gif", "webp", "svg+xml"];
  for (const type of allowed) {
    drawing.files[type] = { dataURL: `data:image/${type},content` };
    drawing.files[type + "64"] = { dataURL: `DATA:IMAGE/${type.toUpperCase()};base64,YQ==` };
  }
  const bad = [
    "https://attacker.invalid/x",
    "//attacker.invalid/x",
    "blob:x",
    "javascript:x",
    "data:text/html,x",
    "data:image/png-extra,x",
    undefined,
    42,
  ];
  bad.forEach((dataURL, i) => {
    drawing.files[String(i)] = { dataURL };
  });
  const result = await renderFlowSvg(drawing, () => undefined, { fonts: false });
  expect(result.rejected.map((f) => f.id)).toEqual(bad.map((_, i) => String(i)));
  expect(result.rejected.every((f) => f.reason.length > 0)).toBe(true);
});

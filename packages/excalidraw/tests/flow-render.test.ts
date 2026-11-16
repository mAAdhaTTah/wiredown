import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { layoutScreen, parse } from "@wiredown/core";
import {
  addScreen,
  connect,
  addNote,
  addHighlight,
  newFlow,
  parseFlow,
  screenElements,
  embedSize,
} from "../src/index.js";
import { renderFlowSvg } from "../src/node.js";

it("exports padded, cached screens, annotations, dark filtering and deterministic bytes", async () => {
  const screen = screenElements(layoutScreen(parse("window: Hello\n  button: World #go").tree));
  const flow = newFlow();
  for (const id of ["one", "two", "one"])
    addScreen(flow, { screenId: id, title: id, path: "screens", size: screen });
  connect(flow, "F1", "F2", { label: "Next" });
  addNote(flow, "F2", "A note");
  addHighlight(flow, "F1", { target: "go", box: screen.boxes.go, screen });
  const lookup = vi.fn(() => screen.elements);
  const light = await renderFlowSvg(flow, lookup);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(light.missing).toEqual([]);
  expect(light.svg.match(/<svg/g)).toHaveLength(1);
  expect(light.svg).toContain("Next");
  expect(light.svg).toContain("A note");
  expect(flow.elements.some((e) => e.type === "arrow")).toBe(true);
  const urls = [...light.svg.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map(
    (m) => m[1],
  );
  expect(new Set(urls).size).toBe(1);
  const nested = Buffer.from(urls[0], "base64").toString();
  expect(nested).toContain("Hello");
  expect(nested).toContain("World");
  expect(nested).toContain("@font-face");
  const padded = embedSize(screen.width, screen.height).image;
  expect(nested).toContain(`viewBox="0 0 ${padded.width} ${padded.height}"`);
  expect(nested).toContain(`x="${(padded.width - screen.width) / 2}" y="0"`);
  expect(light.svg).toContain(`width="${light.width}"`);
  expect(light.svg).toContain(`height="${light.height}"`);
  const dark = await renderFlowSvg(flow, lookup, { theme: "dark" });
  expect(dark.svg).not.toBe(light.svg);
  expect(dark.svg).toContain('filter="invert(93%) hue-rotate(180deg)"');
  expect(dark.svg).toContain(urls[0]);
  expect(await renderFlowSvg(flow, lookup)).toEqual(light);
  const missing = await renderFlowSvg(flow, () => undefined);
  expect(missing.missing).toHaveLength(3);
  expect(missing.svg).toContain("<svg");
}, 30000);

it("exports the real drawing with all three screens missing", async () => {
  const flow = parseFlow(
    readFileSync(new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url), "utf8"),
  );
  expect((await renderFlowSvg(flow, () => undefined)).missing).toHaveLength(3);
});

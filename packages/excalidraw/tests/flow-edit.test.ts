import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  addScreen,
  embedSize,
  flowFrames,
  formatEmbed,
  newFlow,
  parseFlow,
  serializeFlow,
} from "../src/index.js";
import { pluginFailures } from "./plugin-checks.js";
const options = {
  screenId: "home",
  title: "Home",
  path: "screens",
  size: { width: 100, height: 200 },
};
test("geometry, metadata, deletion and numbering", () => {
  const flow = newFlow();
  expect(addScreen(flow, options)).toBe("F1");
  const image = flowFrames(flow)[0].element;
  expect([image.x, image.y, image.width, image.height]).toEqual([0, 0, 120, 205]);
  expect(flow.elements[0]).toMatchObject({
    text: "F1 · Home",
    customData: { wiredown: { frame: "F1", role: "label", screen: "home" } },
  });
  image.x = 500;
  image.y = 100;
  addScreen(flow, { ...options, place: { rightOf: "F1" } });
  expect(flowFrames(flow)[1].element).toMatchObject({ x: 960, y: 100 });
  addScreen(flow, { ...options, place: { below: "F1" } });
  expect(flowFrames(flow)[2].element).toMatchObject({ x: 500, y: 645 });
  image.isDeleted = true;
  flow.elements[0].isDeleted = true;
  expect(addScreen(flow, options)).toBe("F4");
  expect(formatEmbed([...flow.embeds.values()][0])).toBe("screens#^home|120x245");
  expect(pluginFailures(serializeFlow(flow))).toEqual([]);
});
test("legacy fixture is preserved and reserves label numbers", () => {
  const source = readFileSync(
    new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url),
    "utf8",
  );
  const flow = parseFlow(source);
  const old = structuredClone(flow.elements);
  expect(flowFrames(flow)).toEqual([]);
  expect(addScreen(flow, options)).toBe("F4");
  const live = old.filter((e) => !e.isDeleted);
  expect(flowFrames(flow)[0].element).toMatchObject({
    x: Math.max(...live.map((e) => Number(e.x) + Number(e.width))) + 340,
    y: Math.min(...live.map((e) => Number(e.y))),
  });
  const output = parseFlow(serializeFlow(flow));
  expect(output.elements.slice(0, old.length)).toEqual(old);
  expect(output.source.head).toEqual(flow.source.head);
  expect(output.appState).toEqual(flow.appState);
  expect(pluginFailures(serializeFlow(flow))).toEqual([]);
});

test("legacy placement clears all live elements", () => {
  const flow = newFlow();
  flow.elements.push({
    id: "legacy01",
    type: "rectangle",
    x: 100,
    y: -20,
    width: 300,
    height: 200,
  });
  addScreen(flow, options);
  expect(flowFrames(flow)[0].element).toMatchObject({ x: 740, y: -20 });
});

test("embed dimensions include padding, footer and headroom", () => {
  expect(embedSize(100, 200)).toEqual({
    image: { width: 100 + 2 * 10, height: 200 + 5 },
    link: { width: 100 + 2 * 10, height: 200 + 5 + 40 },
  });
});
test("rightmost placement follows moved frames rather than insertion order", () => {
  const flow = newFlow();
  addScreen(flow, options);
  addScreen(flow, options);
  flowFrames(flow)[0].element.x = 1000;
  flowFrames(flow)[0].element.y = 90;
  addScreen(flow, options);
  expect(flowFrames(flow)[2].element).toMatchObject({ x: 1460, y: 90 });
  expect(() => addScreen(flow, { ...options, place: { rightOf: "F99" } })).toThrow(
    'unknown frame "F99" (frames: F1, F2, F3)',
  );
});
test("identities, distinct embeds, and appended indices", () => {
  const flow = newFlow();
  addScreen(flow, options);
  const last = String(flow.elements.at(-1)!.index);
  addScreen(flow, options);
  expect(flow.embeds.size).toBe(2);
  const images = flowFrames(flow);
  expect(images[0].element.fileId).not.toBe(images[1].element.fileId);
  for (const [i, { frame, element }] of images.entries()) {
    expect(element.fileId).toMatch(/^[a-f0-9]{40}$/);
    for (const [offset, role] of ["label", "screen"].entries()) {
      const e = flow.elements[i * 2 + offset];
      expect(e.id).toHaveLength(8);
      expect(e.customData).toEqual({ wiredown: { frame, role, screen: "home" } });
      if (i === 1) expect(String(e.index) > last).toBe(true);
    }
  }
  expect(pluginFailures(serializeFlow(flow))).toEqual([]);
});

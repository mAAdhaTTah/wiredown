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
  embed: { path: "screens", ...embedSize(100, 200).link },
  size: embedSize(100, 200).image,
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
  const output = parseFlow(serializeFlow(flow));
  expect(output.elements.slice(0, old.length)).toEqual(old);
  expect(output.source.head).toEqual(flow.source.head);
  expect(output.appState).toEqual(flow.appState);
  expect(pluginFailures(serializeFlow(flow))).toEqual([]);
});

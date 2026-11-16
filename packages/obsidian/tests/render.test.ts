import { check, layoutScreen, parseScreens } from "@wiredown/core";
import { screenElements } from "@wiredown/excalidraw";
import { expect, it, vi } from "vitest";
import { findScreen, isVariant, MISSING_PLUGIN, renderBlock } from "../src/render";
import type { Automate } from "../src/render";

const source = "text: Hello #hello";
const fence = (s: string, id = "screen") => `\`\`\`wiredown\n${s}\n\`\`\`\n^${id}`;
function setup() {
  const el = document.createElement("div");
  const ea: Automate = {
    copyViewElementsToEAforEditing: vi.fn(),
    createSVG: vi.fn(async () => document.createElementNS("http://www.w3.org/2000/svg", "svg")),
    destroy: vi.fn(),
  };
  return { el, ea, api: async () => ea };
}

it("exports core elements into the required container", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, source, fence(source), api, "light");
  expect(ea.copyViewElementsToEAforEditing).toHaveBeenCalledWith(
    screenElements(layoutScreen(check(source).tree)).elements,
  );
  expect(el.querySelector('.wiredown-block[data-renderer="excalidraw"] svg')).not.toBeNull();
  expect(ea.destroy).toHaveBeenCalledOnce();
});
it("exports light for a dark note", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, source, fence(source), api, "dark");
  expect(el.querySelector<HTMLElement>(".wiredown-block")?.dataset.theme).toBeUndefined();
  expect(ea.createSVG).toHaveBeenCalledWith(
    undefined,
    true,
    { withBackground: false, withTheme: true, isMask: false, skipInliningFonts: false },
    undefined,
    "light",
    0,
  );
});
it.each([true, false])("resolves variants with base before or after: %s", async (before) => {
  const { el, ea, api } = setup();
  const variant = "extends: base\nreplace: hello\n  text: Changed";
  const parts = [fence(source, "base"), fence(variant, "variant")];
  if (!before) parts.reverse();
  await renderBlock(el, variant, parts.join("\n"), api, "light");
  expect(ea.createSVG).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(ea.copyViewElementsToEAforEditing).mock.calls)).toContain(
    "Changed",
  );
});
it("renders diagnostics and source without export", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, "extends: missing", fence("extends: missing"), api, "light");
  expect(el.querySelector(".wiredown-error")?.textContent).toContain("line 2:");
  expect(el.querySelector("code")?.textContent).toBe("extends: missing");
  expect(ea.createSVG).not.toHaveBeenCalled();
});
it("renders warnings after SVG", async () => {
  const { el, api } = setup();
  await renderBlock(el, "text: {warnin} ⋯", fence("text: {warnin} ⋯"), api, "light");
  expect(el.querySelectorAll(".wiredown-warning").length).toBeGreaterThanOrEqual(2);
  expect(el.querySelector("svg")?.nextElementSibling?.className).toBe("wiredown-warning");
});
it("reports absent plugin", async () => {
  const { el } = setup();
  await renderBlock(el, source, fence(source), async () => undefined, "light");
  expect(el.textContent).toContain(MISSING_PLUGIN);
});
it("identifies identical blocks by section, falls back to first text match", () => {
  const screens = parseScreens(fence(source, "one") + "\n" + fence(source, "two"));
  expect(findScreen(screens, source, { lineStart: 4, lineEnd: 6 })).toBe(1);
  expect(findScreen(screens, source)).toBe(0);
  expect(findScreen(screens, "other")).toBe(-1);
});

it("only variants need modify redraws", () => {
  expect(isVariant(source)).toBe(false);
  expect(isVariant("// comment\nextends: base")).toBe(true);
});
it("rejects stale ranges and normalizes line endings", () => {
  const screens = parseScreens(fence(source) + "\n" + fence("text: Other", "other"));
  expect(findScreen(screens, source, { lineStart: 4, lineEnd: 6 })).toBe(0);
  expect(findScreen(screens, "text: Other\r\n", { lineStart: 4, lineEnd: 6 })).toBe(1);
  expect(findScreen(screens, "text: New", { lineStart: 4, lineEnd: 6 })).toBe(-1);
});
it("checks unmatched source on its own", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, "text: New", fence(source), api, "light", { lineStart: 0, lineEnd: 2 });
  expect(JSON.stringify(vi.mocked(ea.copyViewElementsToEAforEditing).mock.calls)).toContain("New");
});
it("caches exports by elements and theme and imports separate equivalent nodes", async () => {
  const { el, ea, api } = setup();
  const cache = new Map<string, string>();
  await renderBlock(el, source, fence(source), api, "light", undefined, cache);
  const first = el.querySelector("svg")!;
  const other = document.implementation.createHTMLDocument().createElement("div");
  await renderBlock(other, source, fence(source), api, "light", undefined, cache);
  const second = other.querySelector("svg")!;
  expect(ea.createSVG).toHaveBeenCalledOnce();
  expect(second).not.toBe(first);
  expect(second.outerHTML).toBe(first.outerHTML);
  expect(second.ownerDocument).toBe(other.ownerDocument);
  await renderBlock(el, source, fence(source), api, "dark", undefined, cache);
  await renderBlock(el, "text: Changed", "", api, "dark", undefined, cache);
  expect(ea.createSVG).toHaveBeenCalledTimes(3);
});

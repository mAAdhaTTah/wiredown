import { afterEach, expect, it, vi } from "vitest";
import { check, layoutScreen, parseScreens } from "@wiredown/core";
import { screenElements } from "@wiredown/excalidraw";
import { findScreen, keepBusy, renderBlock, MISSING_PLUGIN } from "../src/render.js";
import type { Automate } from "../src/render.js";
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
afterEach(() => vi.useRealTimers());
it("exports core elements into the required container", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, source, fence(source), api, "light");
  expect(ea.copyViewElementsToEAforEditing).toHaveBeenCalledWith(
    screenElements(layoutScreen(check(source).tree)).elements,
  );
  expect(el.querySelector('.wiredown-block[data-renderer="excalidraw"] svg')).not.toBeNull();
  expect(ea.destroy).toHaveBeenCalledOnce();
});
it("follows prototype dark-note logic: light export and CSS theme marker", async () => {
  const { el, ea, api } = setup();
  await renderBlock(el, source, fence(source), api, "dark");
  expect(el.querySelector<HTMLElement>(".wiredown-block")?.dataset.theme).toBe("dark");
  expect(vi.mocked(ea.createSVG).mock.calls[0][4]).toBe("light");
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
it.each([false, true])("stops heartbeat on success or rejection: %s", async (fail) => {
  vi.useFakeTimers();
  const { el, ea, api } = setup();
  let finish!: () => void;
  vi.mocked(ea.createSVG).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finish = () =>
          fail
            ? reject(new Error("export failed"))
            : resolve(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      }),
  );
  const pending = renderBlock(el, source, fence(source), api, "light");
  await vi.advanceTimersByTimeAsync(120);
  expect(el.dataset.wiredownBusy).toBeDefined();
  finish();
  await pending;
  expect(el.dataset.wiredownBusy).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  expect(ea.destroy).toHaveBeenCalledOnce();
  if (fail) expect(el.querySelector(".wiredown-error")?.textContent).toContain("export failed");
});
it("clears heartbeat explicitly on unload", () => {
  vi.useFakeTimers();
  const el = document.createElement("div");
  const stop = keepBusy(el);
  vi.advanceTimersByTime(60);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  expect(el.dataset.wiredownBusy).toBeUndefined();
});
it("identifies identical blocks by section, falls back to first text match", () => {
  const screens = parseScreens(fence(source, "one") + "\n" + fence(source, "two"));
  expect(findScreen(screens, source, { lineStart: 4, lineEnd: 6 })).toBe(1);
  expect(findScreen(screens, source)).toBe(0);
  expect(findScreen(screens, "other")).toBe(-1);
});

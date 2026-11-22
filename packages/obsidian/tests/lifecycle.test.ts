import { TFile } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import WiredownPlugin, { Block } from "../src/main";

afterEach(() => vi.useRealTimers());
it.each(["success", "export failure", "read failure", "superseded", "unload"])(
  "runs one attached heartbeat and stops it: %s",
  async (mode) => {
    vi.useFakeTimers();
    const el = document.createElement("div");
    document.body.append(el);
    let finish!: () => void;
    const read = new Promise<string>((resolve, reject) => {
      finish = () => (mode === "read failure" ? reject(new Error("read failed")) : resolve(""));
    });
    const plugin = {
      blocks: new Set<Block>(),
      cache: new Map<string, string>(),
      app: { vault: { getAbstractFileByPath: () => new TFile(), cachedRead: () => read } },
      api: async () => ({
        copyViewElementsToEAforEditing: vi.fn(),
        destroy: vi.fn(),
        createSVG: async () => {
          if (mode === "export failure") throw new Error("export failed");
          return document.createElementNS("http://www.w3.org/2000/svg", "svg");
        },
      }),
    } as unknown as WiredownPlugin;
    const block = new Block(el, plugin, "text: Hello", "note.md", {
      getSectionInfo: () => null,
    } as unknown as MarkdownPostProcessorContext);
    const pending = block.draw();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(el.dataset.wiredownBusy).toBeDefined();
    let newer: Promise<void> | undefined;
    if (mode === "superseded") {
      newer = block.draw();
      expect(vi.getTimerCount()).toBe(1);
    }
    if (mode === "unload") {
      block.onunload();
      expect(vi.getTimerCount()).toBe(0);
    }
    finish();
    await pending;
    await newer;
    expect(vi.getTimerCount()).toBe(0);
    expect(el.dataset.wiredownBusy).toBeUndefined();
    if (mode.endsWith("failure"))
      expect(el.textContent).toContain("Could not draw this wireframe:");
    el.remove();
  },
);

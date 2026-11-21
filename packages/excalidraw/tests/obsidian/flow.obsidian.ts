// Opens flows in real Obsidian with the Excalidraw plugin and checks that the
// plugin reads them as parseFlow does and that its save keeps what
// serializeFlow wrote. Run with `pnpm test:obsidian`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatEmbed } from "../../src/flow";
import { newFlow, parseFlow, serializeFlow, type ExcalidrawElementJson } from "../../src/index";
import { startObsidian, type Obsidian } from "./obsidian";

const FIXTURE = readFileSync(
  new URL("../fixtures/review-and-apply.excalidraw.md", import.meta.url),
  "utf8",
);
const SCREENS = "# Home\n\nA screen. ^home\n";

// The fields Excalidraw gives every element.
function element(id: string, type: string, fields: object): ExcalidrawElementJson {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...fields,
  };
}

// A drawing serializeFlow writes from scratch: a title and a screen embed.
function written(): string {
  const flow = newFlow();
  const title = "Written by wiredown";
  flow.elements.push(
    element("Wdtitle1", "text", {
      index: "a0",
      height: 25,
      text: title,
      rawText: title,
      originalText: title,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    }),
    element("Wdscreen", "image", {
      index: "a1",
      y: 50,
      fileId: "wiredownscreenhome",
      status: "saved",
      scale: [1, 1],
      crop: null,
    }),
  );
  flow.embeds.set("wiredownscreenhome", { path: "screens", blockId: "home", width: 300 });
  return serializeFlow(flow);
}

interface Opened {
  view: string;
  elements: { id: string; type: string; text?: string }[];
  embeds: Record<string, { link: string; file?: string }>;
  loaded: string[];
}

const before = (text: string) => text.slice(0, text.indexOf("## Drawing\n"));

const FLOWS = {
  "flows/review-and-apply.excalidraw.md": FIXTURE,
  "flows/new.excalidraw.md": written(),
};

let obsidian: Obsidian;
beforeAll(async () => {
  obsidian = await startObsidian({ ...FLOWS, "screens.md": SCREENS });
});
afterAll(() => obsidian?.close());

describe.each(Object.entries(FLOWS))("Obsidian with the Excalidraw plugin: %s", (path, text) => {
  let opened: Opened;
  const flow = parseFlow(text);

  beforeAll(async () => {
    opened = await obsidian.run<Opened>(`(async () => {
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}));
      const view = leaf.view;
      while (!view.excalidrawAPI) await new Promise((r) => setTimeout(r, 100));
      // give embeds time to load as images
      await new Promise((r) => setTimeout(r, 3000));
      const embeds = {};
      for (const [id, f] of view.excalidrawData.files)
        embeds[id] = { link: f.linkParts?.original, file: f.file?.path };
      return {
        view: view.getViewType(),
        elements: view.excalidrawAPI.getSceneElements().map(({ id, type, text }) => ({ id, type, text })),
        embeds,
        loaded: Object.keys(view.excalidrawAPI.getFiles()),
      };
    })()`);
  });

  it("opens in the Excalidraw view with the elements parseFlow reads", () => {
    expect(opened.view).toBe("excalidraw");
    const live = flow.elements.filter((e) => !e.isDeleted);
    expect(opened.elements).toEqual(
      live.map(({ id, type, text }) => (type === "text" ? { id, type, text } : { id, type })),
    );
  });

  it("resolves and loads every embed parseFlow reads", () => {
    const expected = Object.fromEntries(
      [...flow.embeds].map(([id, link]) => [id, { link: formatEmbed(link), file: "screens.md" }]),
    );
    expect(opened.embeds).toEqual(expected);
    expect(opened.loaded.sort()).toEqual(Object.keys(expected).sort());
  });

  it("keeps everything before the drawing when the plugin saves", async () => {
    const saved = await obsidian.run<string>(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
      const was = await app.vault.read(file);
      const leaf = app.workspace.getLeavesOfType("excalidraw").find((l) => l.view.file === file);
      await leaf.view.forceSave(true);
      for (let i = 0; i < 100; i++) {
        const now = await app.vault.read(file);
        if (now !== was) return now;
        await new Promise((r) => setTimeout(r, 100));
      }
      return was;
    })()`);
    expect(saved).not.toBe(text);
    expect(before(saved)).toBe(before(text));
    expect(parseFlow(saved).elements.map((e) => e.id)).toEqual(flow.elements.map((e) => e.id));
  });
});

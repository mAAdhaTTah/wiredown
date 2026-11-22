// Opens flows in real Obsidian with the Excalidraw and wiredown plugins and
// checks that the Excalidraw plugin reads them as parseFlow does, that its save
// keeps what serializeFlow wrote, and that flows built by commands keep their
// frames where Obsidian draws the screens. Run with `pnpm test:obsidian`.
import { readFileSync } from "node:fs";
import { checkScreens, layoutScreen } from "@wiredown/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatEmbed } from "../../src/flow";
import { SCREEN_INSET } from "../../src/flow-edit";
import {
  addDecision,
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  embedSize,
  lintFlow,
  newFlow,
  parseFlow,
  refreshFlow,
  screenElements,
  serializeFlow,
  type ExcalidrawElementJson,
  type ScreenLookup,
} from "../../src/index";
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

// A screens file in a subfolder, and a decoy with the same name elsewhere, so
// the written path from the vault root must pick the right one.
const CHECKOUT = [
  "# Cart",
  "",
  "```wiredown",
  "window: Cart",
  "  button: *Checkout #go",
  "```",
  "^cart",
  "",
  "# Done",
  "",
  "```wiredown",
  "window: Done",
  "  text: Thanks",
  "```",
  "^done",
  "",
].join("\n");

/** The screens refresh sees: each block of `source`, laid out now. */
function lookup(source: string): ScreenLookup {
  const screens = checkScreens(source).screens;
  return ({ blockId }) => {
    const screen = screens.find((s) => s.id === blockId);
    if (!screen) return { ok: false, message: `no ^${blockId}` };
    const { width, height, boxes } = screenElements(layoutScreen(screen.tree));
    return { ok: true, screen: { width, height, boxes } };
  };
}

// A drawing as `flow new … cart`, `flow add-screen … done --below F1`,
// `flow decision`, `flow connect`, `flow note`, `flow highlight` and
// `flow mark` write it: frames sized from the rendered screens with the embed
// path from the root, a decision, bound arrows (two between one pair) with
// bound labels, notes in their node's group, and a highlight and a mark with
// bound text in the frame's group.
function commands(source = CHECKOUT): string {
  const flow = newFlow();
  const screens = checkScreens(source).screens;
  for (const [id, place] of [["cart"], ["done", { below: "F1" }]] as const) {
    const screen = screens.find((s) => s.id === id)!;
    const { width, height } = screenElements(layoutScreen(screen.tree));
    addScreen(flow, {
      screenId: id,
      title: screen.heading ?? id,
      path: "docs/checkout/screens",
      size: { width, height },
      place,
    });
  }
  addDecision(flow, { text: "Paid?", place: { rightOf: "F1" } });
  connect(flow, "F1", "D1", { label: "Pay" });
  connect(flow, "F1", "D1");
  connect(flow, "D1", "F2", { label: "Yes" });
  addNote(flow, "F1", "Card details are kept.");
  addNote(flow, "D1", "Retry on a declined card.");
  const cart = screenElements(layoutScreen(screens.find((s) => s.id === "cart")!.tree));
  const go = { target: "go", box: cart.boxes.go, screen: cart };
  addHighlight(flow, "F1", go);
  addMark(flow, "F1", { ...go, label: "1" });
  return serializeFlow(flow);
}

// The same drawing made when the cart screen had one more line, then brought
// up to date by `flow refresh`: a new embed size, and the overlays, notes and
// arrows that moved with it.
function refreshed(): string {
  const before = CHECKOUT.replace("window: Cart\n", "window: Cart\n  text: Two items\n");
  const flow = parseFlow(commands(before));
  const kinds = refreshFlow(flow, lookup(CHECKOUT)).map((c) => c.kind);
  if (!kinds.includes("embed")) throw new Error(`refresh changed only ${kinds.join(", ")}`);
  return serializeFlow(flow);
}

/** Which elements each element is bound to, by id. */
type Bound = Pick<Seen, "id" | "startBinding" | "endBinding" | "boundElements" | "containerId">;
function bindings(elements: Bound[]) {
  const end = (b: unknown) => (b as { elementId?: string } | null | undefined)?.elementId ?? null;
  return elements.map((e) => ({
    id: e.id,
    start: end(e.startBinding),
    end: end(e.endBinding),
    bound: ((e.boundElements as { id: string }[] | null | undefined) ?? []).map((b) => b.id).sort(),
    container: e.containerId ?? null,
  }));
}

interface Seen {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  groupIds: string[];
  customData?: unknown;
  startBinding?: unknown;
  endBinding?: unknown;
  boundElements?: unknown;
  containerId?: unknown;
}

interface Opened {
  view: string;
  elements: Seen[];
  embeds: Record<string, { link: string; file?: string }>;
  loaded: string[];
}

const before = (text: string) => text.slice(0, text.indexOf("## Drawing\n"));

/** Each image's place and size. */
const images = (elements: Partial<Seen>[]) =>
  elements
    .filter((e) => e.type === "image")
    .map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));

/** How Obsidian draws a screen embed: the image, its content box, the screen. */
interface Drawn {
  image: { width: number; height: number };
  foreignObject: { x: number; y: number };
  screen: { x: number; y: number; width: number; height: number } | null;
}

const FLOWS = {
  "flows/review-and-apply.excalidraw.md": FIXTURE,
  "flows/new.excalidraw.md": written(),
  "docs/checkout/flows/commands.excalidraw.md": commands(),
  "docs/checkout/flows/refreshed.excalidraw.md": refreshed(),
};

let obsidian: Obsidian;
beforeAll(async () => {
  obsidian = await startObsidian({
    ...FLOWS,
    "screens.md": SCREENS,
    "docs/checkout/screens.md": CHECKOUT,
    "archive/docs/checkout/screens.md": CHECKOUT,
  });
});
afterAll(() => obsidian?.close());

describe.each(Object.entries(FLOWS))("Obsidian with the Excalidraw plugin: %s", (path, text) => {
  let opened: Opened;
  let saved: string;
  const flow = parseFlow(text);
  const live = flow.elements.filter((e) => !e.isDeleted) as Partial<Seen>[];
  // Flows the commands built, from screens the wiredown plugin renders.
  const built = path.startsWith("docs/checkout/");
  const screens = lookup(CHECKOUT);

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
        elements: view.excalidrawAPI.getSceneElements().map(
          ({ id, type, x, y, width, height, text, groupIds, customData, startBinding, endBinding, boundElements, containerId }) =>
            ({ id, type, x, y, width, height, text, groupIds, customData, startBinding, endBinding, boundElements, containerId }),
        ),
        embeds,
        loaded: Object.keys(view.excalidrawAPI.getFiles()),
      };
    })()`);
  });

  it("opens in the Excalidraw view with the elements parseFlow reads", () => {
    expect(opened.view).toBe("excalidraw");
    expect(opened.elements.map(({ id, type, text }) => ({ id, type, text }))).toEqual(
      live.map(({ id, type, text }) => ({ id, type, text: type === "text" ? text : undefined })),
    );
  });

  // Not every size and place: the plugin reshapes a Markdown embed to the
  // aspect Obsidian renders it at, about its centre, and Excalidraw adjusts
  // arrow ends and the ellipse around a mark's label.
  it("keeps every element's groups and customData", () => {
    const kept = (elements: Partial<Seen>[]) =>
      elements.map(({ id, groupIds, customData }) => ({ id, groupIds, customData }));
    expect(kept(opened.elements)).toEqual(kept(live));
  });

  it("keeps every arrow and text binding, both ways", () => {
    expect(bindings(opened.elements)).toEqual(bindings(live as Bound[]));
  });

  it.runIf(built)("keeps every frame image's place and size", () => {
    expect(images(opened.elements)).toEqual(images(live));
  });

  // Measured as laid out in Obsidian's window, so the host padding and any
  // other CSS inside the image count. overlayBox puts a screen's top-left at
  // SCREEN_INSET inside its image, past a border of SCREEN_INSET.y.
  it.runIf(built)("draws each screen at SCREEN_INSET in an image of embedSize", async () => {
    const drawn = await obsidian.run<Record<string, Drawn>>(`(async () => {
      const leaf = app.workspace.getLeavesOfType("excalidraw")
        .find((l) => l.view.file?.path === ${JSON.stringify(path)});
      const drawn = {};
      for (const [id, file] of Object.entries(leaf.view.excalidrawAPI.getFiles())) {
        const host = document.body.appendChild(document.createElement("div"));
        host.style.cssText = "position: fixed; left: 0; top: 0";
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = await (await fetch(file.dataURL)).text();
        const image = root.querySelector("svg").getBoundingClientRect();
        const box = root.querySelector("foreignObject");
        const screen = root.querySelector("svg.wiredown-svg")?.getBoundingClientRect();
        drawn[id] = {
          image: { width: image.width, height: image.height },
          foreignObject: { x: Number(box.getAttribute("x")), y: Number(box.getAttribute("y")) },
          screen: screen && {
            x: screen.x - image.x,
            y: screen.y - image.y,
            width: screen.width,
            height: screen.height,
          },
        };
        host.remove();
      }
      return drawn;
    })()`);
    const expected = Object.fromEntries(
      [...flow.embeds].map(([id, link]) => {
        const found = screens({ path: link.path, blockId: link.blockId! });
        if (!found.ok) throw new Error(found.message);
        const { width, height } = found.screen;
        return [
          id,
          {
            image: embedSize(width, height).image,
            foreignObject: { x: SCREEN_INSET.y, y: SCREEN_INSET.y },
            screen: { ...SCREEN_INSET, width, height },
          },
        ];
      }),
    );
    expect(drawn).toEqual(expected);
  });

  it("resolves and loads every embed parseFlow reads", () => {
    const expected = Object.fromEntries(
      [...flow.embeds].map(([id, link]) => [
        id,
        { link: formatEmbed(link), file: `${link.path}.md` },
      ]),
    );
    expect(opened.embeds).toEqual(expected);
    expect(opened.loaded.sort()).toEqual(Object.keys(expected).sort());
  });

  it("keeps everything before the drawing when the plugin saves", async () => {
    saved = await obsidian.run<string>(`(async () => {
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
    const after = parseFlow(saved).elements;
    expect(after.map((e) => e.id)).toEqual(flow.elements.map((e) => e.id));
    expect(after.map((e) => [e.groupIds, e.customData])).toEqual(
      flow.elements.map((e) => [e.groupIds, e.customData]),
    );
    expect(bindings(after)).toEqual(bindings(flow.elements));
    expect(parseFlow(saved).compressed).toBe(false);
  });

  it.runIf(built)("saves frames in place, lint-clean, with nothing to refresh", () => {
    expect(images(parseFlow(saved).elements as Partial<Seen>[])).toEqual(images(live));
    expect(lintFlow(parseFlow(saved), screens)).toEqual([]);
    expect(refreshFlow(parseFlow(saved), screens)).toEqual([]);
  });
});

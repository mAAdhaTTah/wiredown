import { layoutScreen } from "@wiredown/core";
import type { SpecNode } from "@wiredown/core";
import { screenElements } from "./elements.js";
import type { ExcalidrawElementJson, ScreenElements } from "./elements.js";
import { embedSize } from "./flow-edit.js";
import type { ScreenRef } from "./flow-refresh.js";
import type { Flow } from "./flow.js";
import { sceneOf } from "./scene.js";

export interface SvgOptions {
  theme?: "light" | "dark";
  /** Inline Excalifont so the SVG is portable. Defaults to true. */
  fonts?: boolean;
}

async function initialize() {
  const { Window } = await import("happy-dom");
  // Excalidraw registers fonts before embedding their bytes. Node has no
  // FontFace; no font loading or canvas measurement is needed for SVG export.
  // Install only this global, once on first use, preserving a host's own.
  if (!("FontFace" in globalThis)) {
    Object.defineProperty(globalThis, "FontFace", {
      configurable: true,
      writable: true,
      value: class {
        status = "unloaded";
        display = "swap";
        style = "normal";
        weight = "400";
        constructor(
          public family: string,
          public source: string,
          descriptors: Record<string, unknown> = {},
        ) {
          Object.assign(this, descriptors);
        }
        load() {
          return Promise.resolve(this);
        }
      },
    });
  }
  const { exportScene } = await import("@excalidraw/utils");
  return { document: new Window().document, exportScene };
}

let runtime: ReturnType<typeof initialize> | undefined;

// Excalidraw tries to subset the font, which fails in Node (it needs
// __dirname), logs a stack trace and embeds the whole font instead. The
// output is right, so that one message is dropped while exports are running.
const NOISE = "Skipped glyph subsetting";
let exporting = 0;
let consoleError = console.error;
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  if (exporting++ === 0) {
    consoleError = console.error;
    console.error = (...args) => {
      if (args[0] !== NOISE) consoleError(...args);
    };
  }
  try {
    return await run();
  } finally {
    if (--exporting === 0) console.error = consoleError;
  }
}

/** Export the adapter's light-theme elements through Excalidraw in Node. */
export async function renderSvg(
  elements: ExcalidrawElementJson[],
  options: SvgOptions = {},
): Promise<string> {
  return exportSvg(sceneOf(elements), options);
}

async function exportSvg(
  data: {
    elements: ExcalidrawElementJson[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  },
  options: SvgOptions,
): Promise<string> {
  const { document, exportScene } = await (runtime ??= initialize());
  const svg = await quietly<{ outerHTML: string }>(() =>
    exportScene({
      type: "svg",
      data,
      config: {
        theme: options.theme ?? "light",
        padding: 0,
        canvasBackgroundColor: false,
        ...(options.fonts === false ? { skipInliningFonts: true } : {}),
        // Excalidraw embeds the font itself; there is nothing to load in Node
        environment: { document, loadFonts: async () => {} },
      },
    }),
  );
  return svg.outerHTML;
}

/** Layout and export a screen, retaining the adapter's size and anchor boxes. */
export async function renderScreenSvg(
  tree: SpecNode,
  options: SvgOptions = {},
): Promise<Omit<ScreenElements, "elements"> & { svg: string }> {
  const { elements, ...screen } = screenElements(layoutScreen(tree));
  return { ...screen, svg: await renderSvg(elements, options) };
}

/**
 * Export a drawing with its block embeds supplied as portable SVG images.
 * `screens` gives an embed's screen elements, or undefined when it has none;
 * it is asked once per embed path and block id.
 */
export async function renderFlowSvg(
  flow: Flow,
  screens: (embed: ScreenRef) => ExcalidrawElementJson[] | undefined,
  options: SvgOptions = {},
): Promise<{
  svg: string;
  width: number;
  height: number;
  missing: ({ element: string } & ScreenRef)[];
  rejected: { id: string; reason: string }[];
}> {
  const files: Record<string, unknown> = {};
  const rejected: { id: string; reason: string }[] = [];
  for (const [id, file] of Object.entries(flow.files)) {
    const dataURL =
      file && typeof file === "object" && "dataURL" in file ? file.dataURL : undefined;
    if (typeof dataURL !== "string") {
      rejected.push({ id, reason: "missing or non-string dataURL" });
    } else if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml)(?:;[^,]*)?,/i.test(dataURL)) {
      rejected.push({ id, reason: "expected an inline PNG, JPEG, GIF, WebP or SVG data URL" });
    } else files[id] = file;
  }
  const cache = new Map<string, string | undefined>();
  const missing: ({ element: string } & ScreenRef)[] = [];
  const elements: ExcalidrawElementJson[] = [];
  for (const element of flow.elements) {
    const fileId = String(element.fileId);
    const embed = flow.embeds.get(fileId);
    const blockId = embed?.blockId;
    if (element.isDeleted || element.type !== "image" || !embed || !blockId) {
      elements.push(element);
      continue;
    }
    // one screen per embed path and block id: same-named blocks in two files differ
    const key = `${embed.path}#^${blockId}`;
    if (!cache.has(key)) {
      const screen = screens({ path: embed.path, blockId });
      if (!screen) cache.set(key, undefined);
      else {
        // The outer dark export filters SVG images; avoid double inversion.
        const svg = await renderSvg(screen, { ...options, theme: "light" });
        const size = svgSize(svg);
        const padded = embedSize(size.width, size.height).image;
        const x = (padded.width - size.width) / 2;
        // This replacement relies on the exporter output starting with "<svg ".
        const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${padded.width}" height="${padded.height}" viewBox="0 0 ${padded.width} ${padded.height}">${svg.replace("<svg ", `<svg x="${x}" y="0" `)}</svg>`;
        cache.set(key, "data:image/svg+xml;base64," + Buffer.from(image).toString("base64"));
      }
    }
    const dataURL = cache.get(key);
    if (dataURL) {
      files[fileId] = { id: fileId, mimeType: "image/svg+xml", dataURL, created: 1 };
      elements.push({ ...element, status: "saved" });
    } else {
      delete files[fileId];
      missing.push({ element: element.id, path: embed.path, blockId });
      elements.push(element);
    }
  }
  const svg = await exportSvg({ elements, appState: flow.appState, files }, options);
  return { svg, ...svgSize(svg), missing, rejected };
}

function svgSize(svg: string): { width: number; height: number } {
  return {
    width: Number(/<svg[^>]* width="([^"]+)"/.exec(svg)![1]),
    height: Number(/<svg[^>]* height="([^"]+)"/.exec(svg)![1]),
  };
}

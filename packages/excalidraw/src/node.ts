import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutScreen } from "@wiredown/core";
import type { SpecNode } from "@wiredown/core";
import { screenElements } from "./elements";
import type { ExcalidrawElementJson, ScreenElements } from "./elements";
import type { Flow } from "./flow";
import { embedSize } from "./flow-edit";
import type { ScreenRef } from "./flow-refresh";
import { sceneOf } from "./scene";

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

export interface PngOptions {
  /** Pixels per SVG unit. Defaults to 1. */
  scale?: number;
  /** A CSS colour painted under the drawing; transparent when omitted. */
  background?: string;
}

/** The canvas colour behind an Excalidraw export: white, and white as dark mode draws it. */
export const BACKGROUND = { light: "#ffffff", dark: "#121212" } as const;

/**
 * Rasterise an SVG from this module to PNG with resvg, drawing text in the
 * Excalifont it embeds. Characters Excalifont lacks use a system font that
 * has them, if there is one.
 */
export async function svgToPng(
  svg: string,
  options: PngOptions = {},
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const scale = options.scale ?? 1;
  if (!(scale > 0 && Number.isFinite(scale))) throw new RangeError(`bad PNG scale ${scale}`);
  const { Resvg } = await import("@resvg/resvg-js");
  const flat = inlineSvgImages(svg);
  const fonts = await Promise.all(
    [...new Set(flat.match(/(?<=url\(data:font\/woff2;base64,)[^)]+/g))].map(woff2ToSfnt),
  );
  // resvg 2.6 loads fonts only from files, and ignores @font-face.
  const dir = await mkdtemp(join(tmpdir(), "wiredown-fonts-"));
  try {
    const fontFiles = await Promise.all(
      fonts.map(async (font, i) => {
        const path = join(dir, `font-${i}.ttf`);
        await writeFile(path, font);
        return path;
      }),
    );
    const image = new Resvg(flat, {
      fitTo: { mode: "zoom", value: scale },
      ...(options.background ? { background: options.background } : {}),
      // Given fonts come first, so they are also the first fallback.
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily: "Excalifont" },
      logLevel: "off",
    }).render();
    return { png: new Uint8Array(image.asPng()), width: image.width, height: image.height };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sfnts = new Map<string, Promise<Uint8Array>>();
function woff2ToSfnt(base64: string): Promise<Uint8Array> {
  let font = sfnts.get(base64);
  if (!font) {
    font = import("woff2-encoder/decompress").then((m) => m.default(Buffer.from(base64, "base64")));
    sfnts.set(base64, font);
  }
  return font;
}

/**
 * Excalidraw draws images as `<use>` of a viewBox-less `<symbol>` holding a
 * 100%-sized `<image>`. resvg sizes such an image against the wrong viewport
 * and draws no text inside SVG images, so SVG images are inlined into their
 * symbol, with a viewBox the `<use>` scales.
 */
function inlineSvgImages(svg: string): string {
  return svg.replace(
    /<symbol id="([^"]+)"><image href="data:image\/svg\+xml;base64,([^"]+)"[^>]*><\/image><\/symbol>/g,
    (symbol, id: string, base64: string) => {
      const inner = inlineSvgImages(Buffer.from(base64, "base64").toString("utf8"));
      const root = /<svg[^>]*>/.exec(inner)?.[0] ?? "";
      const width = / width="([\d.]+)"/.exec(root)?.[1];
      const height = / height="([\d.]+)"/.exec(root)?.[1];
      if (!width || !height) return symbol;
      return `<symbol id="${id}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${inner}</symbol>`;
    },
  );
}

function svgSize(svg: string): { width: number; height: number } {
  return {
    width: Number(/<svg[^>]* width="([^"]+)"/.exec(svg)![1]),
    height: Number(/<svg[^>]* height="([^"]+)"/.exec(svg)![1]),
  };
}

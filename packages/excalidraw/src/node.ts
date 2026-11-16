import { nodeDependency } from "./node-dependency.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutScreen } from "@wiredown/core";
import type { SpecNode } from "@wiredown/core";
import { screenElements } from "./elements";
import type { ExcalidrawElementJson, ScreenElements } from "./elements";
import type { Flow } from "./flow";
import type { ScreenRef } from "./flow-refresh";
import { FLOW_MARGIN, flowScene, svgSize } from "./flow-render";
import { sceneOf } from "./scene";

export { FLOW_MARGIN };

export interface SvgOptions {
  theme?: "light" | "dark";
  /** Inline Excalifont so the SVG is portable. Defaults to true. */
  fonts?: boolean;
}

async function initialize() {
  const { Window } = await nodeDependency("happy-dom", () => import("happy-dom"));
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
  const { exportScene } = await nodeDependency(
    "@excalidraw/utils",
    () => import("@excalidraw/utils"),
  );
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
  padding = 0,
): Promise<string> {
  const { document, exportScene } = await (runtime ??= initialize());
  const svg = await quietly<{ outerHTML: string }>(() =>
    exportScene({
      type: "svg",
      data,
      config: {
        theme: options.theme ?? "light",
        padding,
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

export interface FlowSvgOptions extends SvgOptions {
  /**
   * For PNG output: reject the drawing's own SVG images. resvg would draw
   * local files they link to; raster images are only pixels.
   */
  raster?: boolean;
}

/**
 * Export a drawing with its block embeds supplied as portable SVG images.
 * `screens` gives an embed's screen elements, or undefined when it has none;
 * it is asked once per embed path and block id.
 */
export async function renderFlowSvg(
  flow: Flow,
  screens: (embed: ScreenRef) => ExcalidrawElementJson[] | undefined,
  options: FlowSvgOptions = {},
): Promise<{
  svg: string;
  width: number;
  height: number;
  missing: ({ element: string } & ScreenRef)[];
  rejected: { id: string; reason: string }[];
  /** The screen images this export generated, for `svgToPng`'s `inline`. */
  inline: ReadonlySet<string>;
}> {
  const { missing, rejected, inline, ...scene } = await flowScene(
    flow,
    async (embed) => {
      const screen = screens(embed);
      return screen && renderSvg(screen, { ...options, theme: "light" });
    },
    { raster: options.raster },
  );
  const svg = await exportSvg(scene, options, FLOW_MARGIN);
  return { svg, ...svgSize(svg), missing, rejected, inline };
}

export interface PngOptions {
  /** Pixels per SVG unit. Defaults to 1. */
  scale?: number;
  /** A CSS colour painted under the drawing; transparent when omitted. */
  background?: string;
  /**
   * The trusted screen image data URLs, as `renderFlowSvg` returns them;
   * they are drawn inline. Any other SVG image is refused (see below).
   */
  inline?: ReadonlySet<string>;
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
  const { Resvg } = await nodeDependency("@resvg/resvg-js", () => import("@resvg/resvg-js"));
  const trusted = options.inline ?? new Set();
  refuseUntrustedImages(svg, trusted);
  const flat = inlineSvgImages(svg, trusted);
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
    font = nodeDependency("woff2-encoder", () => import("woff2-encoder/decompress")).then((m) =>
      m.default(Buffer.from(base64, "base64")),
    );
    sfnts.set(base64, font);
  }
  return font;
}

/**
 * resvg loads an image's data URL as an SVG document by its media type, or by
 * sniffing a `text/plain` one, and an SVG document can draw local files (an
 * `feImage`, a pattern's image). So outside the trusted screens, only raster
 * image and font data URLs may appear. Character references are decoded and
 * tabs and newlines dropped first, so neither hides a media type; a DTD could
 * declare entities that do, so one is refused. The SVG's own markup is the
 * caller's: as exported here it links to nothing but data URLs.
 */
function refuseUntrustedImages(svg: string, trusted: ReadonlySet<string>) {
  const refused = () =>
    new Error("svgToPng: refusing an SVG image that is not one of the trusted screens");
  if (/<!ENTITY/i.test(svg)) throw refused();
  // Links are attributes, so scan the tags (and CSS), not a drawing's visible
  // text. Comments, CDATA and processing instructions are tokens of their own:
  // read as tags, a quote inside one would hide part of the tag after it.
  let rest = (
    svg.match(
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
    ) ?? []
  ).join("");
  for (const url of trusted) rest = rest.replaceAll(url, "");
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  rest = rest
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ref, name: string) => {
      if (name[0] !== "#") return named[name] ?? ref;
      const code = Number(name[1].toLowerCase() === "x" ? "0" + name.slice(1) : name.slice(1));
      if (code > 0x10ffff) throw refused();
      return String.fromCodePoint(code);
    })
    .replace(/[\t\n\r]/g, "");
  if (/data:(?!image\/(?:png|jpeg|gif|webp)[;,]|font\/woff2[;,])/i.test(rest)) throw refused();
}

/**
 * Excalidraw draws images as `<use>` of a viewBox-less `<symbol>` holding a
 * 100%-sized `<image>`. resvg sizes such an image against the wrong viewport
 * and draws no text inside SVG images, so trusted SVG images are inlined into
 * their symbol, with a viewBox the `<use>` scales.
 *
 * Once inlined, an SVG's links would be followed by resvg, which reads local
 * files, so only the exact data URLs in `trusted` are inlined: screens this
 * module generated, which hold no links. A drawing can only match one by
 * carrying that same screen, which is harmless.
 */
function inlineSvgImages(svg: string, trusted: ReadonlySet<string>): string {
  return svg.replace(
    /<symbol id="([^"]+)"><image href="(data:image\/svg\+xml;base64,([^"]+))"[^>]*><\/image><\/symbol>/g,
    (symbol, id: string, dataURL: string, base64: string) => {
      if (!trusted.has(dataURL)) return symbol;
      const inner = Buffer.from(base64, "base64").toString("utf8");
      const root = /<svg[^>]*>/.exec(inner)?.[0] ?? "";
      const width = / width="([\d.]+)"/.exec(root)?.[1];
      const height = / height="([\d.]+)"/.exec(root)?.[1];
      if (!width || !height) return symbol;
      return `<symbol id="${id}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${inner}</symbol>`;
    },
  );
}

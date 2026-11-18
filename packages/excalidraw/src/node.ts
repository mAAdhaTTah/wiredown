import { layoutScreen } from "@wiredown/core";
import type { SpecNode } from "@wiredown/core";
import { screenElements } from "./elements";
import type { ExcalidrawElementJson, ScreenElements } from "./elements";
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
  const { document, exportScene } = await (runtime ??= initialize());
  const svg = await quietly<{ outerHTML: string }>(() =>
    exportScene({
      type: "svg",
      data: sceneOf(elements),
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

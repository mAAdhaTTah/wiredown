// The runtime-neutral half of exporting a flow: each screen embed becomes a
// padded SVG image file. Node (node.ts) and the browser (@wiredown/web)
// supply the screen SVGs and run Excalidraw's exporter themselves.
import type { ExcalidrawElementJson } from "./elements";
import type { Flow } from "./flow";
import { embedSize, SCREEN_INSET } from "./flow-edit";
import type { ScreenRef } from "./flow-refresh";

/** Space around a whole flow, so labels at its edge aren't cut. A screen pads itself. */
export const FLOW_MARGIN = 16;

/** The `width` and `height` attributes of an SVG document's root element. */
export function svgSize(svg: string): { width: number; height: number } {
  return {
    width: Number(/<svg[^>]* width="([^"]+)"/.exec(svg)![1]),
    height: Number(/<svg[^>]* height="([^"]+)"/.exec(svg)![1]),
  };
}

/** Wrap a screen's SVG in the space a flow embed gives it (see embedSize). */
export function paddedScreenSvg(svg: string): string {
  const size = svgSize(svg);
  const padded = embedSize(size.width, size.height).image;
  // This replacement relies on the exporter output starting with "<svg ".
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${padded.width}" height="${padded.height}" viewBox="0 0 ${padded.width} ${padded.height}">${svg.replace("<svg ", `<svg x="${SCREEN_INSET.x}" y="${SCREEN_INSET.y}" `)}</svg>`;
}

/** A base64 `data:` URL of an SVG document, in any runtime with btoa. */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:image/svg+xml;base64," + btoa(binary);
}

export interface FlowScene {
  elements: ExcalidrawElementJson[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  rejected: { id: string; reason: string }[];
  /** Screen embeds whose screen could not be drawn; their images are left out. */
  missing: ({ element: string } & ScreenRef)[];
  /** The screen image data URLs generated here, which hold no links. */
  inline: Set<string>;
}

/**
 * The scene to export for a flow, with each `[[path#^id]]` embed supplied
 * as a padded SVG image. `screenSvg` returns an embed's light SVG export, or
 * undefined when the screen is missing; it is called once per embed path and
 * block id (same-named blocks in two files differ). The outer dark export
 * filters SVG images, so screens must be exported light. With `raster`, for
 * PNG output, the drawing's own SVG images are rejected: resvg would draw
 * local files they link to. The screens added here are then the only ones.
 */
export async function flowScene(
  flow: Flow,
  screenSvg: (embed: ScreenRef) => Promise<string | undefined>,
  options: { raster?: boolean } = {},
): Promise<FlowScene> {
  const files: Record<string, unknown> = {};
  const rejected: { id: string; reason: string }[] = [];
  for (const [id, file] of Object.entries(flow.files)) {
    const dataURL =
      file && typeof file === "object" && "dataURL" in file ? file.dataURL : undefined;
    if (typeof dataURL !== "string") {
      rejected.push({ id, reason: "missing or non-string dataURL" });
    } else if (options.raster && /^data:image\/svg\+xml[;,]/i.test(dataURL)) {
      rejected.push({ id, reason: "SVG images are not drawn in PNG output" });
    } else if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml)(?:;[^,]*)?,/i.test(dataURL)) {
      rejected.push({ id, reason: "expected an inline PNG, JPEG, GIF, WebP or SVG data URL" });
    } else files[id] = file;
  }
  const cache = new Map<string, string | undefined>();
  const inline = new Set<string>();
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
    const key = `${embed.path}#^${blockId}`;
    if (!cache.has(key)) {
      const svg = await screenSvg({ path: embed.path, blockId });
      cache.set(key, svg === undefined ? undefined : svgDataUrl(paddedScreenSvg(svg)));
    }
    const dataURL = cache.get(key);
    if (dataURL) {
      inline.add(dataURL);
      files[fileId] = { id: fileId, mimeType: "image/svg+xml", dataURL, created: 1 };
      elements.push({ ...element, status: "saved" });
    } else {
      delete files[fileId];
      missing.push({ element: element.id, path: embed.path, blockId });
      elements.push(element);
    }
  }
  return { elements, appState: flow.appState, files, missing, rejected, inline };
}

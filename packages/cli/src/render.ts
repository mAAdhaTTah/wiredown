import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import type { Box, CheckedScreen } from "@wiredown/core";
import { BACKGROUND, renderFlowSvg, renderScreenSvg, svgToPng } from "@wiredown/excalidraw/node";
import { flowFrames, screenElements } from "@wiredown/excalidraw";
import { renderFlowSvg, renderScreenSvg } from "@wiredown/excalidraw/node";
import { embeddedScreen, embeddedScreens } from "./flow";
import {
  CommandError,
  formatFindings,
  json,
  readSource,
  unknownScreen,
  UsageError,
} from "./output";
import type { Finding, Result } from "./output";
import { NewerFlowError, parseEditableFlow } from "./read-flow";

export interface RenderOptions {
  /** Only these screen ids; all screens with an id when empty. */
  screens?: string[];
  /** Output directory, created if missing. Defaults to ".". */
  out?: string;
  theme?: "light" | "dark";
  /** Embed Excalifont in the SVG. Defaults to true; PNGs always use it. */
  fonts?: boolean;
  /** Defaults to "svg". */
  format?: "svg" | "png";
  /** PNG pixels per SVG unit. Defaults to 2. */
  scale?: number;
  /** Keep a PNG's background transparent instead of the theme's canvas colour. */
  transparent?: boolean;
  json?: boolean;
}

/**
 * A written image. The path is under its format's key (`svg` or `png`).
 * `width` and `height` are the SVG size, which flow embeds use; a PNG adds
 * its size in pixels.
 */
export interface Output {
  svg?: string;
  png?: string;
  width: number;
  height: number;
  pixelWidth?: number;
  pixelHeight?: number;
}

export type RenderedScreen = Output & { id: string; boxes: Record<string, Box> };

/**
 * Render a file's screens to `<out>/<id>.svg`. Screens with errors are
 * skipped and reported; the rest still render, and the exit code is 1.
 */
export async function render(file: string, options: RenderOptions = {}): Promise<Result> {
  if (file.endsWith(".excalidraw.md")) return renderFlow(file, options);
  const checked = checkScreens(await readSource(file));
  const byId = new Map<string, CheckedScreen>();
  for (const screen of checked.screens) {
    if (screen.id !== undefined && !byId.has(screen.id)) byId.set(screen.id, screen);
  }
  const wanted = options.screens?.length ? [...new Set(options.screens)] : [...byId.keys()];
  const include = (f: Finding) => f.screen === undefined || wanted.includes(f.screen);
  const errors: Finding[] = checked.errors.filter(include);
  const warnings: Finding[] = checked.warnings.filter(include);
  const failed = new Set(checked.errors.map((e) => e.screen));
  const known = [...byId.keys()];
  for (const id of wanted.filter((id) => !byId.has(id))) {
    errors.push(unknownScreen(id, known));
  }

  if (!wanted.length) errors.push({ message: "no screens with an ^id to render" });

  const out = options.out ?? ".";
  const screens: RenderedScreen[] = [];
  for (const id of wanted) {
    const screen = byId.get(id);
    if (!screen || failed.has(id)) continue;
    const { svg, width, height, boxes } = await renderScreenSvg(screen.tree, svgOptions(options));
    const output = await writeImage(join(out, id), { svg, width, height }, options, errors, id);
    if (output) screens.push({ id, ...output, boxes });
  }
  return renderResult(file, options, { screens }, screens, errors, warnings);
}

const svgOptions = (options: RenderOptions) => ({
  theme: options.theme,
  fonts: options.format === "png" || options.fonts,
});

/** Write `<base>.svg` or `<base>.png`; a failure is an error finding. */
async function writeImage(
  base: string,
  image: { svg: string; width: number; height: number; inline?: ReadonlySet<string> },
  options: RenderOptions,
  errors: Finding[],
  screen?: string,
): Promise<Output | undefined> {
  const format = options.format ?? "svg";
  const path = `${base}.${format}`;
  const fail = (message: string) => {
    errors.push({ message, ...(screen ? { screen } : {}) });
    return undefined;
  };
  let bytes: string | Uint8Array = image.svg;
  const output: Output = { [format]: path, width: image.width, height: image.height };
  if (format === "png") {
    try {
      const png = await svgToPng(image.svg, {
        scale: options.scale ?? 2,
        inline: image.inline,
        ...(options.transparent ? {} : { background: BACKGROUND[options.theme ?? "light"] }),
      });
      bytes = png.png;
      output.pixelWidth = png.width;
      output.pixelHeight = png.height;
    } catch (error) {
      return fail(`can't render ${path}: ${(error as Error).message}`);
    }
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return output;
  } catch (error) {
    return fail(`can't write ${path}: ${(error as Error).message}`);
  }
}

function renderResult(
  file: string,
  options: RenderOptions,
  data: Record<string, unknown>,
  outputs: Output[],
  errors: Finding[],
  warnings: Finding[],
): Result {
  const format = options.format ?? "svg";
  const line = (o: Output) =>
    `${o[format]}  ${o.width}x${o.height}` +
    (o.pixelWidth ? `  (${o.pixelWidth}x${o.pixelHeight} px)` : "") +
    "\n";
  return {
    exitCode: errors.length ? 1 : 0,
    stdout: options.json
      ? json({ file, format, ...data, errors, warnings })
      : outputs.map(line).join(""),
    stderr: options.json ? "" : formatFindings(file, errors, warnings),
  };
}

async function renderFlow(file: string, options: RenderOptions): Promise<Result> {
  if (options.screens?.length) throw new UsageError("--screen cannot be used with a flow");
  let flow, screens;
  try {
    flow = parseEditableFlow(await readSource(file), "use");
    // each embed's screens file is the one its path names, from the flow
    screens = await embeddedScreens(file, flow);
  } catch (error) {
    // an unreadable flow is exit 2; a drawing we can't use, or a screens file
    // we can't read, is this file's error, as lint reports it
    if (!(error instanceof CommandError || error instanceof FlowError)) throw error;
    const { message } = error;
    return {
      exitCode: 1,
      stdout: options.json ? json({ file, flow: null, errors: [{ message }], warnings: [] }) : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${message}\n`
          : formatFindings(file, [{ message }], []),
    };
  }
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const warned = new Set<string>();
  const rendered = await renderFlowSvg(
    flow,
    (embed) => {
      const found = embeddedScreen(screens, embed);
      const key = `${found.loaded?.path}#^${embed.blockId}`;
      if (found.loaded && !warned.has(key)) {
        warned.add(key);
        warnings.push(...found.loaded.warnings.filter((w) => w.screen === embed.blockId));
      }
      return found.screen && screenElements(layoutScreen(found.screen.tree)).elements;
    },
    { ...svgOptions(options), raster: options.format === "png" },
  );
  for (const { id, reason } of rendered.rejected)
    errors.push({ message: `image file ${id}: ${reason}` });
  // each problem worded as lint words it: frames by name, other images by id
  const frames = new Map(flowFrames(flow).map((f) => [f.element.id, f.frame]));
  const problem = (element: string, message: string) => {
    const frame = frames.get(element);
    errors.push(frame ? { frame, element, message } : { element, message: `an image ${message}` });
  };
  for (const m of rendered.missing)
    problem(
      m.element,
      `embeds [[${m.path}#^${m.blockId}]], but ${embeddedScreen(screens, m).message}`,
    );
  // the plugin also embeds whole files and headings; render draws only screens
  for (const e of flow.elements) {
    const embed = flow.embeds.get(String(e.fileId));
    if (e.isDeleted || e.type !== "image" || !embed || embed.blockId) continue;
    const ref = embed.path + (embed.heading ? `#${embed.heading}` : "");
    problem(e.id, `embeds [[${ref}]], but only screen blocks (#^id) can be rendered`);
  }
  const base = join(options.out ?? ".", basename(file, ".excalidraw.md"));
  // Excalidraw sizes a drawing to its elements, fractions included; screens
  // report whole sizes, so a flow does too
  const size = { width: Math.round(rendered.width), height: Math.round(rendered.height) };
  const output = await writeImage(base, { ...rendered, ...size }, options, errors);
  return renderResult(
    file,
    options,
    { flow: output ?? null },
    output ? [output] : [],
    errors,
    warnings,
  );
}

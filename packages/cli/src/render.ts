import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import type { Box, CheckedScreen } from "@wiredown/core";
import { BACKGROUND, renderFlowSvg, renderScreenSvg, svgToPng } from "@wiredown/excalidraw/node";
import { flowFrames, screenElements } from "@wiredown/excalidraw";
import { renderFlowSvg, renderScreenSvg } from "@wiredown/excalidraw/node";
import { embeddedScreens } from "./flow";
import { formatFindings, json, readSource, unknownScreen, UsageError } from "./output";
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
  let flow;
  try {
    flow = parseEditableFlow(await readSource(file), "use");
  } catch (error) {
    // an unreadable file is exit 2; a drawing we can't use is this file's error
    if (error instanceof UsageError) throw error;
    const { message } = error as Error;
    return {
      exitCode: 1,
      stdout: options.json
        ? json({
            file,
            format: "svg",
            flow: null,
            errors: [{ message }],
            warnings: [],
          })
        : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${message}\n`
          : formatFindings(file, [{ message }], []),
    };
  }
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  // each embed's screens file is the one its path names, from the flow
  const screens = await embeddedScreens(file, flow);
  const warned = new Set<string>();
  const rendered = await renderFlowSvg(
    flow,
    ({ path, blockId }) => {
      const loaded = screens.file(path);
      if (typeof loaded === "string") return undefined;
      const found = loaded.screen(blockId);
      if (!warned.has(`${loaded.path}#^${blockId}`)) {
        warned.add(`${loaded.path}#^${blockId}`);
        warnings.push(...loaded.warnings.filter((w) => w.screen === blockId));
      }
      return found.errors.length
        ? undefined
        : screenElements(layoutScreen(found.screen!.tree)).elements;
    },
    { ...svgOptions(options), raster: options.format === "png" },
  );
  for (const { id, reason } of rendered.rejected)
    errors.push({ message: `image file ${id}: ${reason}` });
  const frames = flowFrames(flow);
  for (const m of rendered.missing) {
    const frame = frames.find((f) => f.element.id === m.element)?.frame;
    const at = { screen: m.blockId, ...(frame ? { frame } : {}) };
    const loaded = screens.file(m.path);
    if (typeof loaded === "string") {
      const what = frame ? "embeds" : "an image embeds";
      errors.push({ ...at, message: `${what} [[${m.path}#^${m.blockId}]], ${loaded}` });
    } else
      for (const finding of loaded.screen(m.blockId).errors)
        errors.push({
          ...at,
          message: frame ? `^${m.blockId}: ${finding.message}` : finding.message,
        });
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

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import type { Box, CheckedScreen } from "@wiredown/core";
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
  /** Embed Excalifont in the SVG. Defaults to true. */
  fonts?: boolean;
  json?: boolean;
}

export interface RenderedScreen {
  id: string;
  svg: string;
  width: number;
  height: number;
  boxes: Record<string, Box>;
}

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
    const { svg, width, height, boxes } = await renderScreenSvg(screen.tree, {
      theme: options.theme,
      fonts: options.fonts,
    });
    const path = join(out, `${id}.svg`);
    if (await writeSvg(path, svg, errors, id))
      screens.push({ id, svg: path, width, height, boxes });
  }
  return renderResult(file, options, { screens }, screens, errors, warnings);
}

async function writeSvg(path: string, svg: string, errors: Finding[], screen?: string) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, svg);
    return true;
  } catch (error) {
    errors.push({
      message: `can't write ${path}: ${(error as Error).message}`,
      ...(screen ? { screen } : {}),
    });
    return false;
  }
}

function renderResult(
  file: string,
  options: RenderOptions,
  data: Record<string, unknown>,
  outputs: { svg: string; width: number; height: number }[],
  errors: Finding[],
  warnings: Finding[],
): Result {
  return {
    exitCode: errors.length ? 1 : 0,
    stdout: options.json
      ? json({ file, ...data, errors, warnings })
      : outputs.map((s) => `${s.svg}  ${s.width}x${s.height}\n`).join(""),
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
    options,
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
  const path = join(options.out ?? ".", basename(file, ".excalidraw.md") + ".svg");
  // Excalidraw sizes a drawing to its elements, fractions included; screens
  // report whole sizes, so a flow does too
  const output = (await writeSvg(path, rendered.svg, errors))
    ? { svg: path, width: Math.round(rendered.width), height: Math.round(rendered.height) }
    : null;
  return renderResult(file, options, { flow: output }, output ? [output] : [], errors, warnings);
}

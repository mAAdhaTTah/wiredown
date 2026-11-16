import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkScreens } from "@wiredown/core";
import type { Box, CheckedScreen } from "@wiredown/core";
import { renderScreenSvg } from "@wiredown/excalidraw/node";
import { formatFindings, json, readSource, unknownScreen } from "./output.js";
import type { Finding, Result } from "./output.js";

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
    try {
      await mkdir(out, { recursive: true });
      await writeFile(path, svg);
      screens.push({ id, svg: path, width, height, boxes });
    } catch (e) {
      // report it with the rest, so the screens already written aren't lost
      errors.push({ message: `can't write ${path}: ${(e as Error).message}`, screen: id });
    }
  }

  const exitCode = errors.length ? 1 : 0;
  if (options.json) {
    return { exitCode, stdout: json({ file, screens, errors, warnings }), stderr: "" };
  }
  return {
    exitCode,
    stdout: screens.map((s) => `${s.svg}  ${s.width}x${s.height}\n`).join(""),
    stderr: formatFindings(file, errors, warnings),
  };
}

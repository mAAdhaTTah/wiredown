import { safeWrite } from "./safe-write.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import {
  addScreen,
  embedSize,
  flowFrames,
  newFlow,
  parseFlow,
  screenElements,
  serializeFlow,
} from "@wiredown/excalidraw";
import { formatFindings, json, unknownScreen, UsageError } from "./output.js";
import type { Finding, Result } from "./output.js";

export interface FlowOptions {
  screens?: string;
  title?: string;
  rightOf?: string;
  below?: string;
  json?: boolean;
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
/** Adds only missing top-level styling keys, preserving the original bytes. */
export function styleScreens(source: string): string {
  const nl = source.includes("\r\n") ? "\r\n" : "\n";
  const front = /^---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?=\r?\n|$)/.exec(source);
  const additions = [
    ["excalidraw-font", "Helvetica"],
    ["excalidraw-css", '".wiredown-block svg{display:block}"'],
  ]
    .filter(
      ([key]) => !new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:`, "m").test(front?.[0] ?? ""),
    )
    .map(([key, value]) => `${key}: ${value}`);
  if (!additions.length) return source;
  if (!front) return ["---", ...additions, "---", "", source].join(nl);
  const close = front[0].lastIndexOf(nl);
  return (
    source.slice(0, close + nl.length) + additions.join(nl) + nl + source.slice(close + nl.length)
  );
}
export async function editFlow(
  command: string,
  file: string,
  ids: string[],
  options: FlowOptions = {},
): Promise<Result> {
  let findings: Finding[] = [];
  let findingFile = file;
  try {
    if (command === "new" && (await exists(file))) throw new Error(`flow already exists: ${file}`);
    const original = command === "new" ? "" : await readFile(file, "utf8");
    const flow = command === "new" ? newFlow() : parseFlow(original);
    const frames = [];
    let screensFileUpdated = false;
    let screensPath: string | undefined;
    let source = "";
    if (ids.length) {
      const candidates = [
        join(dirname(dirname(file)), "screens.md"),
        join(dirname(file), "screens.md"),
      ];
      screensPath = options.screens;
      if (!screensPath) {
        for (const candidate of candidates)
          if (await exists(candidate)) {
            screensPath = candidate;
            break;
          }
      }
      if (!screensPath) throw new Error(`no screens file; tried ${candidates.join(" and ")}`);
      source = await readFile(screensPath, "utf8");
      const checked = checkScreens(source);
      const known = checked.screens.flatMap((s) => (s.id ? [s.id] : []));
      for (const id of ids) {
        const screen = checked.screens.find((s) => s.id === id);
        if (!screen) {
          findings = [unknownScreen(id, known)];
        } else {
          findings = checked.errors.filter((e) => !e.screen || e.screen === id);
        }
        if (findings.length) {
          findingFile = screensPath;
          throw new Error(findings[0].message);
        }
        if (!screen) throw new Error("screen not found");

        const rendered = screenElements(layoutScreen(screen.tree));
        const size = embedSize(rendered.width, rendered.height);
        const title = options.title ?? screen.heading ?? id;
        const frame = addScreen(flow, {
          screenId: id,
          title,
          path: basename(screensPath, ".md"),
          size: { width: rendered.width, height: rendered.height },
          place: options.rightOf
            ? { rightOf: options.rightOf }
            : options.below
              ? { below: options.below }
              : undefined,
        });
        const image = flowFrames(flow).find((f) => f.frame === frame)!.element;
        frames.push({ frame, screen: id, title, x: image.x, y: image.y, ...size.image });
      }
    }
    const output = serializeFlow(flow);
    const styled = styleScreens(source);
    await mkdir(dirname(file), { recursive: true });
    if (command === "new") await writeFile(file, output, { flag: "wx" });
    else await safeWrite(file, original, output);
    if (screensPath && styled !== source) {
      await safeWrite(screensPath, source, styled);
      screensFileUpdated = true;
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json
        ? json({ flow: file, frames, screensFileUpdated })
        : frames.map((f) => `${f.frame}  ${f.screen}  ${f.width}x${f.height}\n`).join(""),
    };
  } catch (error) {
    if (!findings.length) findings = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json
        ? json({
            flow: file,
            frames: [],
            screensFileUpdated: false,
            errors: findings,
          })
        : "",
      stderr: options.json ? "" : formatFindings(findingFile, findings, []),
    };
  }
}
export function flowCommand(
  values: Record<string, string | boolean | string[] | undefined>,
  args: string[],
) {
  const [command, file, ...ids] = args;
  if (command !== "new" && command !== "add-screen")
    throw new UsageError("flow needs new or add-screen");
  if (!file || (command === "add-screen" && ids.length !== 1))
    throw new UsageError(
      `flow ${command} needs a file${command === "add-screen" ? " and one screen id" : ""}`,
    );
  if (values["right-of"] && values.below)
    throw new UsageError("--right-of and --below are mutually exclusive");
  if (command === "new" && (values["right-of"] || values.below || values.title))
    throw new UsageError("placement and title options require add-screen");
  return editFlow(command, file, ids, {
    screens: values.screens as string | undefined,
    title: values.title as string | undefined,
    rightOf: values["right-of"] as string | undefined,
    below: values.below as string | undefined,
    json: values.json === true,
  });
}

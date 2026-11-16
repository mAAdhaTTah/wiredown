import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkScreens, layoutScreen } from "@wiredown/core";
import {
  addDecision,
  addNote,
  addScreen,
  connect,
  embedSize,
  flowFrames,
  flowNodes,
  newFlow,
  screenElements,
  serializeFlow,
} from "@wiredown/excalidraw";
import { screensToEmbed } from "./embeds";
import { formatFindings, json, unknownScreen, UsageError } from "./output";
import type { Finding, Result } from "./output";
import { NewerFlowError, parseEditableFlow } from "./read-flow";
import { safeWrite } from "./safe-write";

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
    const flow = command === "new" ? newFlow() : parseEditableFlow(original);
    const frames = [];
    let screensFileUpdated = false;
    let screensPath: string | undefined;
    let source = "";
    if (ids.length) {
      const embed = await screensToEmbed(file, options.screens);
      screensPath = embed.path;
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
          path: embed.embedPath,
          size: { width: rendered.width, height: rendered.height },
          place: place(options),
        });
        const image = flowFrames(flow).find((f) => f.frame === frame)!.element;
        frames.push({ frame, screen: id, title, x: image.x, y: image.y, ...size.image });
      }
    }
    // flow new scaffolds a path through the row: F1 -> F2 -> F3
    const arrows = [];
    if (command === "new")
      for (const [i, to] of frames.slice(1).entries()) {
        const from = frames[i].frame;
        arrows.push({ id: connect(flow, from, to.frame), from, to: to.frame, label: null });
      }
    const output = serializeFlow(flow);
    const styled = styleScreens(source);
    await mkdir(dirname(file), { recursive: true });
    if (command === "new") await writeFile(file, output, { flag: "wx" });
    else await safeWrite(file, original, output);
    if (screensPath && styled !== source) {
      await safeWrite(screensPath, source, styled).catch(async (error: unknown) => {
        // Take the flow edit back while the flow still holds our output. Best
        // effort, like safeWrite: a save between the check and the undo is lost.
        if (!(await readFile(file)).equals(Buffer.from(output)))
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} Another program also changed ${file}, so it was left as it is, with the new frames.`,
          );
        if (command === "new") await rm(file);
        else await safeWrite(file, output, original);
        throw error;
      });
      screensFileUpdated = true;
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json
        ? json({
            flow: file,
            frames,
            ...(command === "new" ? { arrows } : {}),
            screensFileUpdated,
          })
        : frames.map((f) => `${f.frame}  ${f.screen}  ${f.width}x${f.height}\n`).join("") +
          arrows.map(arrowLine).join(""),
    };
  } catch (error) {
    if (!findings.length) findings = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json
        ? json({
            flow: file,
            frames: [],
            ...(command === "new" ? { arrows: [] } : {}),
            screensFileUpdated: false,
            errors: findings,
          })
        : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${error.message}\n`
          : formatFindings(findingFile, findings, []),
    };
  }
}
interface Arrow {
  id: string;
  from: string;
  to: string;
  label: string | null;
}
const arrowLine = (a: Arrow) =>
  `${a.from} -> ${a.to}${a.label === null ? "" : `  ${JSON.stringify(a.label)}`}\n`;

/**
 * connect, note and decision: one change to an existing drawing, no screens
 * file needed. The drawing is written only if the change succeeds.
 */
export async function editNodes(
  command: "connect" | "note" | "decision",
  file: string,
  args: string[],
  options: FlowOptions = {},
): Promise<Result> {
  const key = command === "connect" ? "arrow" : command;
  try {
    const original = await readFile(file, "utf8");
    const flow = parseEditableFlow(original);
    let value: Record<string, unknown>, line: string;
    if (command === "connect") {
      const [from, to] = args;
      const label = args[2] || undefined;
      const arrow = { id: connect(flow, from, to, { label }), from, to, label: label ?? null };
      [value, line] = [arrow, arrowLine(arrow)];
    } else if (command === "note") {
      const [node, text] = args;
      const id = addNote(flow, node, text);
      [value, line] = [{ id, node }, `${node}  note ${id}\n`];
    } else {
      const node = addDecision(flow, { text: args[0], place: place(options) });
      const e = flowNodes(flow).find((n) => n.node === node)!.element;
      value = { node, x: e.x, y: e.y, width: e.width, height: e.height };
      line = `${node}  ${e.width}x${e.height}\n`;
    }
    await safeWrite(file, original, serializeFlow(flow));
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json ? json({ flow: file, [key]: value }) : line,
    };
  } catch (error) {
    const findings: Finding[] = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json ? json({ flow: file, [key]: null, errors: findings }) : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${error.message}\n`
          : formatFindings(file, findings, []),
    };
  }
}
const place = (options: FlowOptions) =>
  options.rightOf
    ? { rightOf: options.rightOf }
    : options.below
      ? { below: options.below }
      : undefined;

/** Positionals each command takes after the file: [required, optional]. */
const ARITY: Record<string, [number, number, string]> = {
  new: [0, Infinity, "a file"],
  "add-screen": [1, 0, "a file and one screen id"],
  connect: [2, 1, "a file, two nodes and an optional label"],
  note: [2, 0, "a file, a node and the note's text"],
  decision: [1, 0, "a file and the decision's text"],
};

export function flowCommand(
  values: Record<string, string | boolean | string[] | undefined>,
  args: string[],
) {
  const [command, file, ...rest] = args;
  const arity = Object.hasOwn(ARITY, command ?? "") ? ARITY[command] : undefined;
  if (!arity) throw new UsageError(`flow needs ${Object.keys(ARITY).join(", ")}`);
  if (!file || rest.length < arity[0] || rest.length > arity[0] + arity[1])
    throw new UsageError(`flow ${command} needs ${arity[2]}`);
  if ((command === "note" || command === "decision") && !rest.at(-1)?.trim())
    throw new UsageError(`flow ${command} needs non-empty text`);
  if (values["right-of"] && values.below)
    throw new UsageError("--right-of and --below are mutually exclusive");
  const placed = command === "add-screen" || command === "decision";
  if (!placed && (values["right-of"] || values.below))
    throw new UsageError("placement options require add-screen or decision");
  const screens = command === "new" || command === "add-screen";
  if (!screens && (values.title || values.screens))
    throw new UsageError("--title and --screens require new or add-screen");
  if (command === "new" && values.title) throw new UsageError("--title requires add-screen");
  const options = {
    screens: values.screens as string | undefined,
    title: values.title as string | undefined,
    rightOf: values["right-of"] as string | undefined,
    below: values.below as string | undefined,
    json: values.json === true,
  };
  if (command === "connect" || command === "note" || command === "decision")
    return editNodes(command, file, rest, options);
  return editFlow(command, file, rest, options);
}

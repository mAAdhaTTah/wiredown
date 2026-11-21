import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkScreens, layoutScreen, nearest } from "@wiredown/core";
import {
  addDecision,
  addHighlight,
  addMark,
  addNote,
  addScreen,
  connect,
  embedSize,
  flowFrames,
  flowNodes,
  lintFlow,
  moveNode,
  newFlow,
  parseFlow,
  refreshFlow,
  removeFromFlow,
  screenElements,
  serializeFlow,
} from "@wiredown/excalidraw";
import type {
  Flow,
  FlowChange,
  Moved,
  MoveTo,
  Removed,
  ScreenRef,
  ScreenState,
} from "@wiredown/excalidraw";
import { embedRoot, frameEmbed, resolveEmbed, screensToEmbed } from "./embeds";
import { formatFindings, json, plural, readSource, unknownScreen, UsageError } from "./output";
import type { Finding, Result } from "./output";
import { NewerFlowError, parseEditableFlow } from "./read-flow";
import { safeWrite } from "./safe-write";

export interface FlowOptions {
  screens?: string;
  title?: string;
  rightOf?: string;
  below?: string;
  to?: string;
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
      const loaded = await loadScreens(embed.path);
      screensPath = loaded.path;
      source = loaded.source;
      for (const id of ids) {
        const { screen, errors } = loaded.screen(id);
        findings = errors;
        if (findings.length) {
          findingFile = screensPath;
          throw new Error(findings[0].message);
        }
        const rendered = screenElements(layoutScreen(screen!.tree));
        const size = embedSize(rendered.width, rendered.height);
        const title = options.title ?? screen!.heading ?? id;
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

/** Load a screens file once, retaining only errors relevant to each selection. */
export async function loadScreens(path: string) {
  const source = await readSource(path);
  const checked = checkScreens(source);
  return {
    path,
    source,
    warnings: checked.warnings,
    screen(id: string) {
      const screen = checked.screens.find((s) => s.id === id);
      const errors = screen
        ? checked.errors.filter((e) => !e.screen || e.screen === id)
        : [
            unknownScreen(
              id,
              checked.screens.flatMap((s) => (s.id ? [s.id] : [])),
            ),
          ];
      return { screen, errors };
    },
  };
}

/**
 * Each screens file a flow's embeds name, resolved from the flow and read
 * once. `file(path)` is the loaded file an embed path names, or why there is
 * none; `unresolved` holds each embed path that names no file, and why;
 * `paths` the path new embeds of each resolved one's file are written with;
 * `ambiguous` each embed path several files match.
 */
export async function embeddedScreens(file: string, flow: Flow) {
  const root = await embedRoot(file);
  const files = new Map<string, Awaited<ReturnType<typeof loadScreens>>>();
  const unresolved = new Map<string, string>();
  const paths = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const embed of flow.embeds.values()) {
    if (!embed.blockId || files.has(embed.path) || unresolved.has(embed.path)) continue;
    const found = await resolveEmbed(file, embed.path, root);
    if ("why" in found) {
      unresolved.set(embed.path, found.why);
      if (found.ambiguous) ambiguous.add(embed.path);
    } else {
      files.set(embed.path, await loadScreens(found.path));
      paths.set(embed.path, found.embedPath);
    }
  }
  return {
    unresolved,
    paths,
    ambiguous,
    file: (path: string) => files.get(path) ?? unresolved.get(path) ?? "but it was not resolved",
  };
}

/**
 * The screens lookup lint and refresh take: each screen laid out once.
 * `errors` collects, per screens file, why screens asked for are unavailable.
 */
async function screenLookup(file: string, flow: Flow) {
  const { file: screensFile, unresolved, paths, ambiguous } = await embeddedScreens(file, flow);
  const cache = new Map<string, ScreenState | string>();
  const errors = new Map<string, Finding[]>();
  const state = ({ path, blockId }: ScreenRef): ScreenState | string => {
    const loaded = screensFile(path);
    if (typeof loaded === "string") return loaded;
    const { screen, errors: found } = loaded.screen(blockId);
    if (found.length) {
      errors.set(loaded.path, [...(errors.get(loaded.path) ?? []), ...found]);
      return screen
        ? `but ^${blockId} in ${loaded.path} has errors`
        : `but ${loaded.path} has no ^${blockId}`;
    }
    const { width, height, boxes } = screenElements(layoutScreen(screen!.tree));
    return { width, height, boxes };
  };
  const lookup = (embed: ScreenRef) => {
    const key = `${embed.path}#^${embed.blockId}`;
    if (!cache.has(key)) cache.set(key, state(embed));
    return cache.get(key)!;
  };
  return { lookup, errors, unresolved, paths, ambiguous };
}

/** One flow's lint result, as `flow lint` and `lint` report it. */
export interface LintedFlow {
  file: string;
  findings: Finding[];
}
export async function lintFlowFile(file: string): Promise<LintedFlow> {
  const source = await readSource(file);
  try {
    const flow = parseFlow(source);
    const { lookup } = await screenLookup(file, flow);
    return { file, findings: lintFlow(flow, lookup) };
  } catch (error) {
    return { file, findings: [{ message: (error as Error).message }] };
  }
}
/** Findings and a summary line per flow. */
export function formatLinted(results: LintedFlow[]): string {
  return results
    .map(
      (r) =>
        formatFindings(r.file, r.findings, []) +
        `${r.file}: ${plural(r.findings.length, "error")}\n`,
    )
    .join("");
}
/** Lint each flow against its screens; exit 1 if any has findings. Never writes. */
export async function lintFlows(files: string[], options: FlowOptions = {}): Promise<Result> {
  const results: LintedFlow[] = [];
  for (const file of files) results.push(await lintFlowFile(file));
  const exitCode = results.some((r) => r.findings.length) ? 1 : 0;
  return {
    exitCode,
    stdout: options.json ? json({ files: results }) : formatLinted(results),
    stderr: "",
  };
}

const sizeText = (s: { width?: number; height?: number }) => `${s.width ?? "?"}x${s.height ?? "?"}`;
function changeLine(c: FlowChange): string {
  if (c.kind === "embed") {
    const { link, image } = c;
    const same = link.from.width === link.to.width && link.from.height === link.to.height;
    return same
      ? `${c.frame}  image ${sizeText(image.from)} -> ${sizeText(image.to)}\n`
      : `${c.frame}  embed ${sizeText(link.from)} -> ${sizeText(link.to)}\n`;
  }
  if (c.kind === "label") return `${c.frame}  label moved\n`;
  if (c.kind === "group") return `${c.frame}  ${c.part} regrouped\n`;
  if (c.kind === "note") return `${c.frame}  note ${c.element} moved\n`;
  const what =
    c.kind === "arrow"
      ? `arrow ${c.from} -> ${c.to}`
      : c.kind === "mark"
        ? `mark ${c.label} #${c.target}`
        : `highlight #${c.target}`;
  const done = c.kind === "arrow" ? "re-routed" : "moved";
  return `${c.frame}  ${what} ${c.unresolved ? `unresolved: ${c.unresolved}` : done}\n`;
}

/**
 * Bring a flow up to date with its screens. Writes only if something
 * changed. A missing or invalid screen, or an embed whose screens file is
 * not found, is reported (exit 1); the other frames are still refreshed.
 */
export async function refreshFlowFile(file: string, options: FlowOptions = {}): Promise<Result> {
  try {
    const original = await readFile(file, "utf8");
    const flow = parseEditableFlow(original);
    const { lookup, errors, unresolved: lost, paths, ambiguous } = await screenLookup(file, flow);
    // a frame whose embed several files match would be a guess: report it
    // and write nothing
    const guess = flowFrames(flow).some(({ element }) =>
      ambiguous.has(flow.embeds.get(String(element.fileId))?.path ?? ""),
    );
    const all = guess ? [] : refreshFlow(flow, lookup);
    const decompressed = flow.compressed && !guess;
    const changes = all.filter((c) => !("unresolved" in c && c.unresolved));
    // an embed refresh rewrites takes the path new embeds are written with
    for (const c of changes) {
      if (c.kind !== "embed") continue;
      const fileId = String(flow.elements.find((e) => e.id === c.element)!.fileId);
      const embed = flow.embeds.get(fileId)!;
      flow.embeds.set(fileId, { ...embed, path: paths.get(embed.path) ?? embed.path });
    }
    const unresolved = all.filter((c) => "unresolved" in c && c.unresolved);
    if (changes.length || decompressed) await safeWrite(file, original, serializeFlow(flow));
    // each frame whose embed names no file, then each screens file's errors;
    // an error outside any screen affects every screen: report it once
    const reports: { file: string; findings: Finding[] }[] = [
      {
        file,
        findings: flowFrames(flow).flatMap(({ frame, element }) => {
          const embed = flow.embeds.get(String(element.fileId));
          const why = embed && lost.get(embed.path);
          return why
            ? [{ frame, message: `embeds [[${embed.path}#^${embed.blockId}]], ${why}` }]
            : [];
        }),
      },
      ...[...errors].map(([path, found]) => {
        const seen = new Set<string>();
        const findings = found.filter((f) => {
          const key = JSON.stringify(f);
          return !seen.has(key) && !!seen.add(key);
        });
        return { file: path, findings };
      }),
    ];
    const found = reports.flatMap((r) => r.findings.map((f) => ({ file: r.file, ...f })));
    const exitCode = found.length ? 1 : 0;
    if (options.json)
      return {
        exitCode,
        stdout: json({
          flow: file,
          ...(decompressed ? { decompressed: true } : {}),
          changes,
          unresolved,
          ...(found.length ? { errors: found } : {}),
        }),
        stderr: "",
      };
    return {
      exitCode,
      stdout:
        (decompressed ? "rewrote compressed-json drawing as JSON\n" : "") +
        (all.length
          ? all.map(changeLine).join("")
          : decompressed || guess || exitCode
            ? ""
            : "up to date\n"),
      stderr: reports.map((r) => formatFindings(r.file, r.findings, [])).join(""),
    };
  } catch (error) {
    const findings: Finding[] = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json
        ? json({ flow: file, changes: [], unresolved: [], errors: findings })
        : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${error.message}\n`
          : formatFindings(file, findings, []),
    };
  }
}

export async function editOverlay(
  command: "highlight" | "mark",
  file: string,
  args: string[],
  options: FlowOptions = {},
): Promise<Result> {
  let findings: Finding[] = [];
  let findingFile = file;
  try {
    const original = await readFile(file, "utf8");
    const flow = parseEditableFlow(original);
    const [frame, targetArg, label] = args;
    const target = targetArg.replace(/^#/, "");
    const { path, blockId: screen } = await frameEmbed(file, flow, frame);
    const loaded = await loadScreens(path);
    findingFile = loaded.path;
    const { screen: found, errors } = loaded.screen(screen);
    findings = errors;
    if (findings.length) throw new Error(findings[0].message);
    const rendered = screenElements(layoutScreen(found!.tree));
    const box = rendered.boxes[target];
    if (!box) {
      const ids = Object.keys(rendered.boxes);
      const guess = nearest(target, ids);
      throw new Error(
        `no component "#${target}" on ^${screen} (ids: ${ids.map((id) => "#" + id).join(", ") || "none"})${guess ? `; did you mean "#${guess}"?` : ""}`,
      );
    }
    findingFile = file;
    const overlay = { target, box, screen: rendered };
    const id =
      command === "highlight"
        ? addHighlight(flow, frame, overlay)
        : addMark(flow, frame, { ...overlay, label });
    const e = flow.elements.find((e) => e.id === id)!;
    const value =
      command === "highlight"
        ? { id, frame, screen, target, x: e.x, y: e.y, width: e.width, height: e.height }
        : { id, frame, screen, target, label, x: e.x, y: e.y };
    await safeWrite(file, original, serializeFlow(flow));
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json
        ? json({ flow: file, [command]: value })
        : `${frame}  ${command}${command === "mark" ? " " + label : ""}  #${target}\n`,
    };
  } catch (error) {
    if (!findings.length) findings = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json ? json({ flow: file, [command]: null, errors: findings }) : "",
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
function removedLine(r: Removed): string {
  if (r.kind === "frame" || r.kind === "decision") {
    const parts = [
      r.kind,
      ...(r.notes ? [plural(r.notes, "note")] : []),
      ...(r.overlays ? [plural(r.overlays, "overlay")] : []),
      ...(r.arrows ? [plural(r.arrows, "arrow")] : []),
    ].join(", ");
    return r.copy
      ? `removed ${r.element}, one of the elements claiming ${r.node} (${parts})\n` +
          (r.labelLeft
            ? `left the label of ${r.node}, and any notes or overlays pasted with it: the copy has no group of its own; remove them by element id\n`
            : "")
      : `removed ${r.node} (${parts})\n`;
  }
  if (r.kind === "copy") {
    const more = r.elements.length - 1;
    return `removed ${r.element}, a copy of ${r.of}${more ? `, and ${plural(more, "element")} pasted with it` : ""}\n`;
  }
  if (r.kind === "arrow")
    return `removed ${r.arrows && r.arrows > 1 ? `${r.arrows} arrows` : "arrow"} ${r.from} -> ${r.to}\n`;
  if (r.kind === "highlight") return `removed highlight ${r.node} #${r.target}\n`;
  if (r.kind === "mark") return `removed mark ${r.node} #${r.target} ${r.label}\n`;
  if (r.kind === "note")
    return `removed ${r.notes && r.notes > 1 ? `${r.notes} notes` : `note ${r.element}`} on ${r.node}\n`;
  return `removed label ${r.element}${r.node ? ` of ${r.node}` : ""}\n`;
}
/** flow remove: every target is checked first; the drawing is written once, or not at all. */
export async function removeFlowItems(
  file: string,
  targets: string[],
  options: FlowOptions = {},
): Promise<Result> {
  try {
    const original = await readFile(file, "utf8");
    const flow = parseEditableFlow(original);
    const { removed, unbound } = removeFromFlow(flow, targets);
    await safeWrite(file, original, serializeFlow(flow));
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json
        ? json({ flow: file, removed, unbound })
        : removed.map(removedLine).join("") +
          unbound.map((u) => `unbound a hand-drawn arrow ${u.element} from ${u.from}\n`).join(""),
    };
  } catch (error) {
    const findings: Finding[] = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json ? json({ flow: file, removed: [], unbound: [], errors: findings }) : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${error.message}\n`
          : formatFindings(file, findings, []),
    };
  }
}
function movedLine(m: Moved): string {
  const parts = [
    m.kind,
    ...(m.notes ? [plural(m.notes, "note")] : []),
    ...(m.overlays ? [plural(m.overlays, "overlay")] : []),
    ...(m.arrows ? [plural(m.arrows, "arrow")] : []),
  ].join(", ");
  return `moved ${m.node} to ${m.x},${m.y} (${parts})\n` + m.unresolved.map(changeLine).join("");
}
/** flow move: the node and what of ours belongs to it, written once, or not at all. */
export async function moveFlowNode(
  file: string,
  node: string,
  to: MoveTo,
  options: FlowOptions = {},
): Promise<Result> {
  try {
    const original = await readFile(file, "utf8");
    const flow = parseEditableFlow(original);
    const moved = moveNode(flow, node, to);
    if (moved.unchanged) {
      const message = `${node} is already at ${moved.x},${moved.y}`;
      return {
        exitCode: 0,
        stderr: "",
        stdout: options.json
          ? json({ flow: file, moved: null, unresolved: [], message })
          : `${message}\n`,
      };
    }
    await safeWrite(file, original, serializeFlow(flow));
    const { unresolved, ...value } = moved;
    return {
      exitCode: 0,
      stderr: "",
      stdout: options.json ? json({ flow: file, moved: value, unresolved }) : movedLine(moved),
    };
  } catch (error) {
    const findings: Finding[] = [{ message: (error as Error).message }];
    return {
      exitCode: 1,
      stdout: options.json
        ? json({ flow: file, moved: null, unresolved: [], errors: findings })
        : "",
      stderr: options.json
        ? ""
        : error instanceof NewerFlowError
          ? `${file}: ${error.message}\n`
          : formatFindings(file, findings, []),
    };
  }
}
/** --to <x>,<y> as a top-left, else --right-of or --below. */
function moveTo(options: FlowOptions): MoveTo {
  if (!options.to) return place(options)!;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(options.to);
  if (!m) throw new UsageError(`--to is <x>,<y>, such as 760,0, not "${options.to}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}
const place = (options: FlowOptions) =>
  options.rightOf
    ? { rightOf: options.rightOf }
    : options.below
      ? { below: options.below }
      : undefined;

/** Positionals each command takes after the file: [required, optional]. */
const ARITY: Record<string, [number, number, string]> = {
  refresh: [0, 0, "one file"],
  lint: [0, Infinity, "at least one file"],
  highlight: [2, 0, "a file, a frame and a component id"],
  mark: [3, 0, "a file, a frame, a component id and a label"],
  new: [0, Infinity, "a file"],
  "add-screen": [1, 0, "a file and one screen id"],
  connect: [2, 1, "a file, two nodes and an optional label"],
  note: [2, 0, "a file, a node and the note's text"],
  decision: [1, 0, "a file and the decision's text"],
  remove: [1, Infinity, "a file and at least one thing to remove"],
  move: [1, 0, "a file and a node"],
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
  if ((command === "note" || command === "decision" || command === "mark") && !rest.at(-1)?.trim())
    throw new UsageError(`flow ${command} needs non-empty text`);
  const placements = [values["right-of"], values.below, values.to].filter(Boolean).length;
  if (placements > 1) throw new UsageError("--right-of, --below and --to are mutually exclusive");
  const placed = command === "add-screen" || command === "decision" || command === "move";
  if (!placed && (values["right-of"] || values.below))
    throw new UsageError("placement options require add-screen, decision or move");
  if (command !== "move" && values.to) throw new UsageError("--to requires move");
  if (command === "move" && !placements)
    throw new UsageError("flow move needs --right-of <node>, --below <node> or --to <x>,<y>");
  const screens = command === "new" || command === "add-screen";
  if (command !== "add-screen" && values.title) throw new UsageError("--title requires add-screen");
  // other commands follow each frame's embed to its screens file
  if (!screens && values.screens) throw new UsageError("--screens requires new or add-screen");
  const options = {
    screens: values.screens as string | undefined,
    title: values.title as string | undefined,
    rightOf: values["right-of"] as string | undefined,
    below: values.below as string | undefined,
    to: values.to as string | undefined,
    json: values.json === true,
  };
  if (command === "refresh") return refreshFlowFile(file, options);
  if (command === "lint") return lintFlows([file, ...rest], options);
  if (command === "highlight" || command === "mark")
    return editOverlay(command, file, rest, options);
  if (command === "remove") return removeFlowItems(file, rest, options);
  if (command === "move") return moveFlowNode(file, rest[0], moveTo(options), options);
  if (command === "connect" || command === "note" || command === "decision")
    return editNodes(command, file, rest, options);
  return editFlow(command, file, rest, options);
}

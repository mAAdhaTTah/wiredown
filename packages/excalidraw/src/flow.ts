// A flow is an Obsidian Excalidraw drawing (`flows/<name>.excalidraw.md`)
// that the agent and a person both edit. parseFlow reads one; serializeFlow
// regenerates the parts derived from the scene and keeps the rest verbatim.
import LZString from "lz-string";
import type { ExcalidrawElementJson } from "./elements.js";

/** A parsed `[[link]]` from `## Embedded Files`, in the plugin's link grammar. */
export interface EmbedLink {
  path: string;
  /** `#^id`: a block reference, as for a screen in screens.md. */
  blockId?: string;
  /** `#Heading`: a heading reference. */
  heading?: string;
  width?: number;
  height?: number;
}

export interface Flow {
  /** The scene's elements, as read: unknown fields are kept. */
  elements: ExcalidrawElementJson[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  /** Image `fileId` → its `## Embedded Files` link. */
  embeds: Map<string, EmbedLink>;
  /** What serializeFlow needs to reproduce the parts it does not own. */
  readonly source: FlowSource;
}

/** Opaque to callers. */
export interface FlowSource {
  /** Text before `# Excalidraw Data`: frontmatter and the warning line. */
  head: string;
  /** From `# Excalidraw Data` up to `## Drawing`; owned sections are markers. */
  parts: Part[];
  /** Ids in `## Text Elements`, in file order. */
  textOrder: string[];
  /** `## Embedded Files` entries, in file order. */
  fileEntries: FileEntry[];
  /** The scene object; its elements, appState and files come from the Flow. */
  scene: Record<string, unknown>;
  drawing: Drawing;
}

type Part = string | typeof TEXT | typeof FILES;
const TEXT = 0;
const FILES = 1;

interface FileEntry {
  fileId: string;
  /** The whole entry, as read, without the newlines after it. */
  raw: string;
  /** The newlines after it. */
  sep: string;
  /** The text inside `[[ ]]`, when the entry is a link. */
  link?: string;
}

interface Drawing {
  /** `## Drawing\n```json\n` as read. */
  open: string;
  compressed: boolean;
  /** JSON.stringify's indent, or undefined for single-line JSON. */
  indent?: string;
  /** Compressed form: characters per line and the separator between lines. */
  chunk: number;
  separator: string;
  /** Body and everything after it, as read. */
  body: string;
  close: string;
  /** The scene re-stringified at read time; unchanged means write `body` back. */
  json: string;
}

const PLUGIN_SOURCE = "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/tag/2.29.0";
const WARNING =
  "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'";
const TEXT_HEADING = "## Text Elements\n";
const FILES_HEADING = "## Embedded Files\n";
/** The plugin's end of a text element entry: ` ^` and an 8-character id. */
const TEXT_MARKER = /\s\^(.{8})\n+/g;

/** Parses an Obsidian Excalidraw drawing. Throws if it is not one. */
export function parseFlow(text: string): Flow {
  if (text.includes("\r\n"))
    throw new Error("Excalidraw drawing: CRLF line endings are not supported");
  const d = /\n(##? Drawing\n```(json|compressed-json)\n)/.exec(text);
  if (!d) throw new Error('not an Excalidraw drawing: no "## Drawing" json block');
  const before = text.slice(0, d.index + 1);
  const bodyStart = d.index + d[0].length;
  // Neither JSON.stringify nor base64 can produce a line that is just ```.
  const fence = /^```$/m.exec(text.slice(bodyStart));
  if (!fence) throw new Error('not an Excalidraw drawing: "## Drawing" block is not closed');
  const closeStart = Math.max(bodyStart, bodyStart + fence.index - 1);
  const body = text.slice(bodyStart, closeStart);
  const compressed = d[2] === "compressed-json";

  let json = body;
  if (compressed) {
    json = LZString.decompressFromBase64(body.replace(/[\r\n]/g, "")) ?? "";
    if (!json) throw new Error("Excalidraw drawing: compressed-json does not decompress");
  }
  let scene: unknown;
  try {
    scene = JSON.parse(json);
  } catch (e) {
    throw new Error(`Excalidraw drawing: drawing JSON does not parse: ${(e as Error).message}`);
  }
  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    throw new Error("Excalidraw drawing: drawing JSON has no elements array");
  }
  const indent = /^\{\n([ \t]+)/.exec(json)?.[1];
  const lines = body.split("\n").filter(Boolean);

  const ex = /^# Excalidraw Data$/m.exec(before);
  if (!ex) throw new Error('not an Excalidraw drawing: no "# Excalidraw Data" section');
  const { parts, sections } = splitSections(before.slice(ex.index));

  const textOrder = [...(sections[TEXT] ?? "").matchAll(TEXT_MARKER)].map((m) => m[1]);
  const fileEntries = parseFileEntries(sections[FILES] ?? "");
  const embeds = new Map<string, EmbedLink>();
  for (const e of fileEntries) if (e.link !== undefined) embeds.set(e.fileId, parseEmbed(e.link));

  return {
    elements: scene.elements as ExcalidrawElementJson[],
    appState: isRecord(scene.appState) ? scene.appState : {},
    files: isRecord(scene.files) ? scene.files : {},
    embeds,
    source: {
      head: before.slice(0, ex.index),
      parts,
      textOrder,
      fileEntries,
      scene,
      drawing: {
        open: d[1],
        compressed,
        indent,
        chunk: lines.length > 1 ? lines[0].length : Infinity,
        separator: body.includes("\n\n") ? "\n\n" : "\n",
        body,
        close: text.slice(closeStart),
        json: JSON.stringify(scene, null, indent),
      },
    },
  };
}

/**
 * Writes a flow back. Regenerates `## Text Elements`, `## Embedded Files` and
 * the drawing JSON from the scene; keeps everything else as read.
 */
export function serializeFlow(flow: Flow): string {
  const { head, parts, textOrder, fileEntries, scene, drawing } = flow.source;
  const live = flow.elements.filter((e) => !e.isDeleted);

  const texts = new Map(live.filter((e) => e.type === "text").map((e) => [e.id, e]));
  const textIds = [...new Set([...textOrder.filter((id) => texts.has(id)), ...texts.keys()])];
  const textBody = textIds
    .map((id) => `${textOf(texts.get(id)!)} ^${checkTextId(id)}\n\n`)
    .join("");

  const used = new Set(live.filter((e) => e.type === "image").map((e) => String(e.fileId)));
  const entries: string[] = [];
  const written = new Set<string>();
  for (const e of fileEntries) {
    if (!used.has(e.fileId) || written.has(e.fileId)) continue;
    const embed = flow.embeds.get(e.fileId);
    if (e.link === undefined || (embed && sameEmbed(embed, parseEmbed(e.link)))) {
      entries.push(e.raw + e.sep);
    } else if (!embed) continue;
    else entries.push(e.raw.replace(`[[${e.link}]]`, () => `[[${formatEmbed(embed)}]]`) + e.sep);
    written.add(e.fileId);
  }
  for (const fileId of used) {
    const embed = flow.embeds.get(fileId);
    if (written.has(fileId) || !embed) continue;
    entries.push(`${fileId}: [[${formatEmbed(embed)}]]\n\n`);
  }
  const filesBody = entries.join("");

  let all = parts;
  if (textBody && !all.includes(TEXT)) all = insertBeforeEnd(all, TEXT);
  if (filesBody && !all.includes(FILES)) all = insertBeforeEnd(all, FILES);
  const data = all
    .map((p) =>
      p === TEXT
        ? TEXT_HEADING + textBody
        : p === FILES
          ? filesBody && FILES_HEADING + filesBody
          : p,
    )
    .join("");

  const next: Record<string, unknown> = { ...scene };
  next.elements = flow.elements;
  next.appState = flow.appState;
  next.files = flow.files;
  const json = JSON.stringify(next, null, drawing.indent);
  const body =
    json === drawing.json
      ? drawing.body
      : drawing.compressed
        ? chunk(LZString.compressToBase64(json), drawing.chunk).join(drawing.separator)
        : json;
  return head + data + drawing.open + body + drawing.close;
}

/** An empty drawing, written as the prototype writes one. */
export function newFlow(): Flow {
  const scene = {
    type: "excalidraw",
    version: 2,
    source: PLUGIN_SOURCE,
    elements: [],
    appState: { theme: "light", viewBackgroundColor: "#ffffff" },
    files: {},
  };
  return parseFlow(
    ["---", "", "excalidraw-plugin: parsed", "tags: [excalidraw]", "", "---", WARNING, "", ""]
      .concat(["# Excalidraw Data", "", "## Text Elements", "%%", "## Drawing", "```json"])
      .concat([JSON.stringify(scene, null, "\t"), "```", "%%"])
      .join("\n"),
  );
}

/** `screens#^id|WxH`: the text inside an embed's `[[ ]]`. */
export function formatEmbed(link: EmbedLink): string {
  const ref = link.blockId ? `#^${link.blockId}` : link.heading ? `#${link.heading}` : "";
  const size =
    link.width === undefined && link.height === undefined
      ? ""
      : `|${link.width ?? ""}${link.height === undefined ? "" : `x${link.height}`}`;
  return link.path + ref + size;
}

/** Parses the text inside `[[ ]]` the way the plugin does (linkUtils getLinkParts). */
export function parseEmbed(link: string): EmbedLink {
  const m = /(^[^#|]*)#?(\^)?([^|]*)?\|?(\d*)x?(\d*)/.exec(link)!;
  const out: EmbedLink = { path: m[1] };
  if (m[3]) out[m[2] ? "blockId" : "heading"] = m[3];
  if (m[4]) out.width = parseInt(m[4], 10);
  if (m[5]) out.height = parseInt(m[5], 10);
  return out;
}

// Splits the data part (up to `## Drawing`) into verbatim text and the
// sections we own. Structure is found from the plugin's own markers, never
// from text content:
// - `## Text Elements` spans up to `## Element Links`, `## Embedded Files` or
//   the `%%` before `## Drawing`. Within that span, lines that look like
//   headings are text; the section ends after its last ` ^id` marker, and
//   anything after that marker is kept verbatim.
// - `## Embedded Files` runs to the next `## ` heading or that `%%`.
function splitSections(data: string): { parts: Part[]; sections: (string | undefined)[] } {
  const close = data.endsWith("\n%%\n") ? data.length - 3 : data.length;
  const parts: Part[] = [];
  const sections: (string | undefined)[] = [];
  let pos = 0;
  const own = (kind: typeof TEXT | typeof FILES, heading: number, start: number, stop: number) => {
    parts.push(data.slice(pos, heading), kind);
    sections[kind] = data.slice(start, stop);
    pos = stop;
  };
  const t = /^## Text Elements\n/m.exec(data.slice(0, close));
  if (t) {
    const start = t.index + t[0].length;
    const next = /^## (Element Links|Embedded Files)\n/m.exec(data.slice(start, close));
    const span = data.slice(start, next ? start + next.index : close);
    const last = [...span.matchAll(TEXT_MARKER)].at(-1);
    own(TEXT, t.index, start, start + (last ? last.index + last[0].length : 0));
  }
  const f = /^## Embedded Files\n/m.exec(data.slice(pos, close));
  if (f) {
    const start = pos + f.index + f[0].length;
    const next = /^## /m.exec(data.slice(start, close));
    own(FILES, pos + f.index, start, next ? start + next.index : close);
  }
  parts.push(data.slice(pos));
  return { parts: parts.filter((p) => p !== ""), sections };
}

// The plugin's grammar: an entry starts with `fileId:` at the start of a
// line (`[[link]]`, a URL or LaTeX) and may be followed by blank lines or none.
function parseFileEntries(body: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const m of body.matchAll(/^([\w\d]+):.*(?:\n(?![\w\d]+:)(?=[^\n]).*)*(\n*)/gm)) {
    const raw = m[0].slice(0, m[0].length - m[2].length);
    const link = /^[\w\d]+:\s*!?\[\[([^\]]*)]]/.exec(raw)?.[1];
    entries.push({ fileId: m[1], raw, sep: m[2], link });
  }
  return entries;
}

// A new owned section goes before the `%%` that closes the data part.
function insertBeforeEnd(parts: Part[], kind: Part): Part[] {
  const last = parts.at(-1);
  if (typeof last !== "string" || !/(^|\n)%%\n$/.test(last)) return [...parts, kind];
  return [...parts.slice(0, -1), last.slice(0, -3), kind, "%%\n"].filter((p) => p !== "");
}

function textOf(e: ExcalidrawElementJson): string {
  return String(e.rawText ?? e.originalText ?? e.text ?? "");
}

// The plugin finds text elements by ` ^` and exactly eight characters.
function checkTextId(id: string): string {
  if (id.length !== 8) throw new Error(`text element id "${id}" must be 8 characters`);
  return id;
}

function sameEmbed(a: EmbedLink, b: EmbedLink): boolean {
  return (
    a.path === b.path &&
    a.blockId === b.blockId &&
    a.heading === b.heading &&
    a.width === b.width &&
    a.height === b.height
  );
}

function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

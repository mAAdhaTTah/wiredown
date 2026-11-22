// Draws the loader's targets in place. What it knows of the page comes in
// the targets (gitea.ts reads it), and Excalidraw's exporter is passed in.
import { checkScreens, FENCE_KEYWORD, layoutScreen } from "@wiredown/core";
import type { CheckedScreen, CheckScreensResult, ScreenDiagnostic } from "@wiredown/core";
import {
  embedNotFound,
  embedSize,
  FLOW_MARGIN,
  flowFrames,
  flowScene,
  parseFlow,
  resolveEmbedPath,
  sceneOf,
  screenElements,
} from "@wiredown/excalidraw";
import type { ExcalidrawElementJson } from "@wiredown/excalidraw";
import type { Block, FlowTarget, Theme } from "./gitea";
import { notice } from "./loader";
import type { Targets } from "./loader";

/** Excalidraw 0.18.1's font family ids, by their folder under fonts/. */
const FAMILIES: Record<string, number> = {
  Virgil: 1,
  Cascadia: 3,
  Nunito: 6,
  Lilita: 7,
  ComicShanns: 8,
  Liberation: 9,
};

export interface ExportScene {
  elements: ExcalidrawElementJson[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Excalidraw's SVG export, without background, with the given padding. */
export type ExportSvg = (
  scene: ExportScene,
  options: { theme: Theme; padding: number },
) => Promise<SVGSVGElement>;

const STYLE = `.wiredown-block{margin:0.5em 0}
.wiredown-svg{display:block;max-width:100%;height:auto}
.wiredown-error{color:#d1242f;margin:0.25em 0}
.wiredown-warning,.wiredown-notice{opacity:0.75;font-size:0.875em;margin:0.25em 0}
.wiredown-source>summary{cursor:pointer;opacity:0.75;font-size:0.875em}`;

export async function render(
  targets: Targets,
  exportSvg: ExportSvg,
  document: Document,
  /** Comma-separated font folders the site added next to Excalifont. */
  fonts?: string,
): Promise<void> {
  if (!document.getElementById("wiredown-style")) {
    const style = document.createElement("style");
    style.id = "wiredown-style";
    style.textContent = STYLE;
    document.head.append(style);
  }
  const { theme } = targets;
  if (targets.blocks.length)
    await renderBlocks(targets.blocks, targets.noteUrl, exportSvg, document, theme);
  if (targets.flow) await renderFlow(targets.flow, exportSvg, document, theme, fonts);
}

function warn(element: Element, what: string, error: unknown, where?: "before" | "after") {
  console.warn(`wiredown: ${what}`, error);
  notice(element, `${what}: ${error instanceof Error ? error.message : String(error)}`, where);
}

/** Fetch text from the page's own origin; nothing else is ever fetched. */
export async function fetchText(url: string, document: Document): Promise<string | undefined> {
  if (new URL(url).origin !== new URL(document.URL).origin)
    throw new Error(`refusing to fetch ${url} from another origin`);
  // a redirect could leave the origin, so it is an error
  const response = await fetch(url, { credentials: "same-origin", redirect: "error" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

interface Resolved {
  screen?: CheckedScreen;
  errors: string[];
  warnings: string[];
}

const normalized = (source: string) => source.replace(/\r\n?/g, "\n").trim();

/** A Markdown file of the page's own blocks, for pages that are not one file. */
function pageMarkdown(blocks: Block[]): string {
  return blocks
    .map(({ source, id }) => {
      const fence = "`".repeat(
        Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      return `${fence}${FENCE_KEYWORD}\n${source}\n${fence}\n${id ? `^${id}\n` : ""}`;
    })
    .join("\n");
}

/**
 * Check blocks as the CLI checks a file: against the page's own Markdown file
 * when the page shows one and every block is in it (file lines), otherwise
 * against the blocks on the page (lines within each block).
 */
export function resolveBlocks(blocks: Block[], note: string | undefined): Resolved[] {
  let checked: CheckScreensResult | undefined;
  let matched: (CheckedScreen | undefined)[] = [];
  if (note !== undefined) {
    checked = checkScreens(note);
    const used = new Set<CheckedScreen>();
    matched = blocks.map((block) => {
      const screen = checked!.screens.find(
        (s) => !used.has(s) && normalized(s.source) === normalized(block.source),
      );
      if (screen) used.add(screen);
      return screen;
    });
  }
  const inFile = checked !== undefined && matched.every(Boolean);
  if (!inFile) {
    checked = checkScreens(pageMarkdown(blocks));
    matched = checked.screens;
  }
  return blocks.map((_, i) => {
    const screen = matched[i]!;
    const lines = screen.source.split("\n").length;
    const belongs = (d: ScreenDiagnostic) =>
      d.screen !== undefined
        ? d.screen === screen.id
        : d.line >= screen.line - 1 && d.line <= screen.line + lines;
    const format = (d: ScreenDiagnostic) =>
      `line ${inFile ? d.line : d.line - screen.line + 1}: ${d.message}`;
    return {
      screen,
      errors: checked!.errors.filter(belongs).map(format),
      warnings: checked!.warnings.filter(belongs).map(format),
    };
  });
}

function messages(document: Document, className: string, items: string[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = className;
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  return list;
}

function fitted(svg: SVGSVGElement): SVGSVGElement {
  svg.removeAttribute("class");
  svg.classList.add("wiredown-svg");
  return svg;
}

async function renderBlocks(
  blocks: Block[],
  url: string | undefined,
  exportSvg: ExportSvg,
  document: Document,
  theme: Theme,
) {
  let note: string | undefined;
  if (url) {
    try {
      note = await fetchText(url, document);
    } catch (error) {
      // Variants then resolve against the page's blocks only.
      console.warn("wiredown: could not read this page's Markdown file", error);
    }
  }
  let resolved: Resolved[];
  try {
    resolved = resolveBlocks(blocks, note);
  } catch (error) {
    for (const block of blocks) warn(block.element, "Could not check this wireframe", error);
    return;
  }
  for (const [i, block] of blocks.entries()) {
    const { screen, errors, warnings } = resolved[i]!;
    try {
      const container = document.createElement("div");
      container.className = "wiredown-block";
      if (errors.length || !screen) {
        // The source stays visible under the errors.
        container.append(messages(document, "wiredown-error", errors));
        block.element.replaceWith(container);
        container.append(block.element);
        continue;
      }
      const svg = await exportSvg(sceneOf(screenElements(layoutScreen(screen.tree)).elements), {
        theme,
        padding: 0,
      });
      container.dataset.renderer = "excalidraw";
      container.append(fitted(svg));
      if (warnings.length) container.append(messages(document, "wiredown-warning", warnings));
      const details = document.createElement("details");
      details.className = "wiredown-source";
      const summary = document.createElement("summary");
      summary.textContent = "Source";
      details.append(summary);
      block.element.replaceWith(container);
      details.append(block.element);
      container.append(details);
    } catch (error) {
      warn(block.element, "Could not draw this wireframe", error);
    }
  }
}

async function renderFlow(
  target: FlowTarget,
  exportSvg: ExportSvg,
  document: Document,
  theme: Theme,
  fonts = "",
) {
  try {
    const text = await fetchText(target.url, document);
    if (text === undefined) throw new Error(`${target.url}: not found`);
    const flow = parseFlow(text);
    const problems: string[] = [];
    // Each embed's screens file within the repository's raw root, by the
    // part of the CLI's rule a browser can apply (resolveEmbedPath): it
    // cannot list the repository, so a link that is a trailing part of a
    // path is tried from each folder above the flow, nearest first. "exists"
    // is a same-origin fetch, kept for reading.
    const fetched = new Map<string, string | undefined>();
    const exists = async (url: string) => {
      if (!fetched.has(url)) fetched.set(url, await fetchText(url, document));
      return fetched.get(url) !== undefined;
    };
    const files = new Map<string, CheckScreensResult | string>();
    for (const { path, blockId } of flow.embeds.values()) {
      if (!blockId || files.has(path)) continue;
      const found = await resolveEmbedPath(target.url, path, exists, target.root);
      files.set(
        path,
        found.ok
          ? checkScreens(fetched.get(found.url)!)
          : found.reason === "outside"
            ? `it points outside ${target.root}`
            : embedNotFound(path, new URL(".", target.url).href, target.root),
      );
    }
    const serializer = new (document.defaultView?.XMLSerializer ?? XMLSerializer)();
    const sizes = new Map<string, { width: number; height: number }>();
    const { missing, rejected, ...scene } = await flowScene(flow, async ({ path, blockId }) => {
      const checked = files.get(path);
      if (typeof checked !== "object") return undefined;
      const screen = checked.screens.find((s) => s.id === blockId);
      if (!screen || checked.errors.some((e) => e.screen === blockId)) return undefined;
      const { elements, width, height } = screenElements(layoutScreen(screen.tree));
      sizes.set(`${path}#^${blockId}`, { width, height });
      // The outer dark export filters SVG images; export screens light.
      const svg = await exportSvg(sceneOf(elements), { theme: "light", padding: 0 });
      return serializer.serializeToString(svg);
    });
    // A frame keeps the size of the screen it was made or refreshed for; a
    // screen that changed since is drawn squeezed into it.
    const stale = flowFrames(flow).some(({ element }) => {
      const embed = flow.embeds.get(String(element.fileId));
      const size = embed && sizes.get(`${embed.path}#^${embed.blockId}`);
      const want = size && embedSize(size.width, size.height).link;
      return want && (embed.width !== want.width || embed.height !== want.height);
    });
    problems.push(...rejected.map(({ id, reason }) => `image file ${id}: ${reason}`));
    // Excalifont (5) is shipped, Helvetica (2) is a local font, and the
    // site may have added other families' folders (data-fonts).
    const shipped = new Set([2, 5, ...fonts.split(",").map((f) => FAMILIES[f.trim()])]);
    const unsupported = new Set<number>();
    scene.elements = scene.elements.map((element) => {
      const family = Number(element.fontFamily ?? 5);
      if (element.isDeleted || element.type !== "text" || shipped.has(family)) return element;
      unsupported.add(family);
      return { ...element, fontFamily: 5 };
    });
    for (const family of unsupported)
      problems.push(`text in font ${family} is drawn in a fallback font`);
    const seen = new Set<string>();
    for (const { path, blockId } of missing) {
      const link = `[[${path}#^${blockId}]]`;
      if (seen.has(link)) continue;
      seen.add(link);
      const checked = files.get(path)!;
      const error = typeof checked === "object" && checked.errors.find((e) => e.screen === blockId);
      problems.push(
        typeof checked === "string"
          ? `${link}: ${checked}`
          : error
            ? `${link}: line ${error.line}: ${error.message}`
            : `${link}: no such screen`,
      );
    }
    const svg = await exportSvg(scene, { theme, padding: FLOW_MARGIN });
    const container = document.createElement("div");
    container.className = "wiredown-block wiredown-flow";
    container.dataset.renderer = "excalidraw";
    container.append(fitted(svg));
    if (problems.length)
      container.append(messages(document, "wiredown-notice", ["Not drawn:", ...problems]));
    if (stale)
      container.append(
        messages(document, "wiredown-notice", [
          "This flow is out of date with its screens; run wiredown flow refresh.",
        ]),
      );
    const details = document.createElement("details");
    details.className = "wiredown-source";
    const summary = document.createElement("summary");
    summary.textContent = "Source";
    details.append(summary);
    target.element.before(container);
    details.append(target.element);
    container.append(details);
  } catch (error) {
    warn(target.element, "Could not draw this flow", error, "before");
  }
}

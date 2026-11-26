// What wiredown reads from a Gitea page. Every assumption about Gitea's HTML
// and URLs is here; `pnpm test:gitea` checks them on Gitea 28.4.0:
// - A fenced block renders as `pre > code.language-<lang>`, possibly inside
//   a `.code-block-container`.
// - A `^id` line after a block renders as the next element, a paragraph
//   whose whole text is `^id`.
// - Each rendered Markdown document (a file view, a comment, a comment's
//   preview) is a `.markup` element.
// - The theme is named on `<html data-theme>`; names containing "dark" are
//   dark, names containing "auto" follow the OS.
// - A file view is `.../src/{branch|tag|commit}/<ref>/<path>` and its raw
//   text is the same URL with `/raw/` for `/src/`; rendered Markdown in a
//   file view is in `.file-view.markup`.
// - The repository's raw-content root, which bounds the search for a flow's
//   screens files, is `.../raw/{branch|tag|commit}/<ref>/`. A ref containing
//   `/` cannot be told from the path after it, so the root is taken at the
//   ref's first segment: the shortest plausible root.
// - Fomantic UI's `ui tiny compact icon button` classes style a button as
//   Gitea's own (zoom.ts uses them for a flow's controls).
import { FENCE_KEYWORD } from "@wiredown/core";

export type Theme = "light" | "dark";

/** A rendered `wiredown` code block. */
export interface Block {
  /** The element the drawing replaces; it is kept under the drawing. */
  element: HTMLElement;
  /** The block's text, as written between the fences. */
  source: string;
  /** The block's `^id`, when the page shows one after the block. */
  id?: string;
  /**
   * The rendered Markdown document the block is in. Ids and variants resolve
   * among the blocks of one document, so two comments may use the same ids.
   */
  markup?: Element;
}

/** A page that shows a rendered `.excalidraw.md` file. */
export interface FlowTarget {
  /** The rendered Markdown; the drawing is shown above it. */
  element: HTMLElement;
  /** Same-origin URL of the file's raw text. */
  url: string;
  /**
   * Same-origin URL, ending in `/`, of the repository's raw-content root:
   * the search for the flow's screens files never goes above it.
   */
  root: string;
}

/** Set on an element once wiredown has handled it, so it is not handled twice. */
export const DONE = "data-wiredown";

const CODE = `pre > code.language-${FENCE_KEYWORD}`;
const MARKUP = ".markup";
const FILE_VIEW = ".file-view.markup";
const ID = /^\^([A-Za-z0-9-]+)$/;

/** The raw-file URL of a Gitea file view URL, or undefined if it is not one. */
export function rawUrl(pageUrl: string): string | undefined {
  const url = new URL(pageUrl);
  const path = url.pathname.replace(/\/src\/(branch|tag|commit)\//, "/raw/$1/");
  if (path === url.pathname) return undefined;
  return url.origin + path;
}

/** The raw-content root of a raw-file URL: `.../raw/<kind>/<first ref segment>/`. */
export function rawRoot(rawFileUrl: string): string | undefined {
  return /^.*?\/raw\/(?:branch|tag|commit)\/[^/]+\//.exec(rawFileUrl)?.[0];
}

function fileView(
  document: Document,
  suffix: RegExp,
): { element: HTMLElement; url: string } | undefined {
  const element = document.querySelector<HTMLElement>(FILE_VIEW);
  const url = rawUrl(document.URL);
  if (!element || !url || !suffix.test(new URL(url).pathname)) return undefined;
  return { element, url };
}

/** The page's `wiredown` blocks that are not drawn yet. */
export function findBlocks(document: Document): Block[] {
  const blocks: Block[] = [];
  for (const code of document.querySelectorAll<HTMLElement>(CODE)) {
    const pre = code.parentElement!;
    const element = pre.closest<HTMLElement>(".code-block-container") ?? pre;
    if (element.hasAttribute(DONE)) continue;
    const id = ID.exec(element.nextElementSibling?.textContent?.trim() ?? "")?.[1];
    const markup = element.closest(MARKUP);
    blocks.push({
      element,
      source: (code.textContent ?? "").replace(/\n$/, ""),
      ...(id ? { id } : {}),
      ...(markup ? { markup } : {}),
    });
  }
  return blocks;
}

/** The flow the page shows, if it shows one that is not drawn yet. */
export function findFlow(document: Document): FlowTarget | undefined {
  const view = fileView(document, /\.excalidraw\.md$/i);
  const root = view && rawRoot(view.url);
  return view && root && !view.element.hasAttribute(DONE) ? { ...view, root } : undefined;
}

/**
 * Same-origin URL of the raw Markdown file the page shows, when it shows
 * one file, so variants resolve as the CLI resolves them.
 */
export function noteUrl(document: Document): string | undefined {
  return fileView(document, /\.(md|markdown)$/i)?.url;
}

/** The page's current theme. */
export function theme(document: Document): Theme {
  const name = document.documentElement.dataset.theme ?? "";
  if (name.includes("dark")) return "dark";
  if (name.includes("auto"))
    return document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  return "light";
}

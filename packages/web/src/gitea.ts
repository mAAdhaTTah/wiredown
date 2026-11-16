// Gitea adapter. Every assumption about Gitea's HTML and URLs is here, and
// none has been checked on a live Gitea:
// - A fenced block renders as `pre > code.language-<lang>`, possibly inside
//   a `.code-block-container`.
// - A `^id` line after a block renders as the next element, a paragraph
//   whose whole text is `^id`.
// - The theme is named on `<html data-theme>`; names containing "dark" are
//   dark, names containing "auto" follow the OS.
// - A file view is `.../src/{branch|tag|commit}/<ref>/<path>` and its raw
//   text is the same URL with `/raw/` for `/src/`; rendered Markdown in a
//   file view is in `.file-view.markup`.
// - The repository's raw-content root, which bounds the search for a flow's
//   screens files, is `.../raw/{branch|tag|commit}/<ref>/`. A ref containing
//   `/` cannot be told from the path after it, so the root is taken at the
//   ref's first segment: the shortest plausible root.
import { FENCE_KEYWORD } from "@wiredown/core";
import { DONE } from "./host";
import type { Block, FlowTarget, Host, Theme } from "./host";

const CODE = `pre > code.language-${FENCE_KEYWORD}`;
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

export const gitea: Host = {
  findBlocks(document) {
    const blocks: Block[] = [];
    for (const code of document.querySelectorAll<HTMLElement>(CODE)) {
      const pre = code.parentElement!;
      const element = pre.closest<HTMLElement>(".code-block-container") ?? pre;
      if (element.hasAttribute(DONE)) continue;
      const id = ID.exec(element.nextElementSibling?.textContent?.trim() ?? "")?.[1];
      blocks.push({
        element,
        source: (code.textContent ?? "").replace(/\n$/, ""),
        ...(id ? { id } : {}),
      });
    }
    return blocks;
  },
  findFlow(document): FlowTarget | undefined {
    const view = fileView(document, /\.excalidraw\.md$/i);
    const root = view && rawRoot(view.url);
    return view && root && !view.element.hasAttribute(DONE) ? { ...view, root } : undefined;
  },
  noteUrl(document) {
    return fileView(document, /\.(md|markdown)$/i)?.url;
  },
  theme(document): Theme {
    const name = document.documentElement.dataset.theme ?? "";
    if (name.includes("dark")) return "dark";
    if (name.includes("auto"))
      return document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    return "light";
  },
};

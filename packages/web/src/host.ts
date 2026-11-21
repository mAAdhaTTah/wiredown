// What the renderer needs to know about the page it runs on. Everything that
// depends on a particular forge's HTML lives behind this interface, in one
// adapter module per host (only Gitea, in gitea.ts).

export type Theme = "light" | "dark";

/** A rendered `wiredown` code block. */
export interface Block {
  /** The element the drawing replaces; it is kept under the drawing. */
  element: HTMLElement;
  /** The block's text, as written between the fences. */
  source: string;
  /** The block's `^id`, when the host shows one after the block. */
  id?: string;
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

export interface Host {
  /** The page's `wiredown` blocks that are not drawn yet. Must be cheap. */
  findBlocks(document: Document): Block[];
  /** The flow the page shows, if it shows one that is not drawn yet. Must be cheap. */
  findFlow(document: Document): FlowTarget | undefined;
  /**
   * Same-origin URL of the raw Markdown file the page shows, when it shows
   * one file, so variants resolve as the CLI resolves them.
   */
  noteUrl(document: Document): string | undefined;
  /** The page's current theme. */
  theme(document: Document): Theme;
}

/** Set on an element once wiredown has handled it, so it is not handled twice. */
export const DONE = "data-wiredown";

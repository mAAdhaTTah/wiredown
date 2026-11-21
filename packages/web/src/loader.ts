// The small script every page loads. It looks for wireframes and, only when
// there are some, imports the renderer that sits next to it.
import { DONE } from "./host";
import type { Block, FlowTarget, Host } from "./host";

export interface Targets {
  blocks: Block[];
  flow?: FlowTarget;
}

/** The renderer module's interface (wiredown-renderer.js). */
export interface Renderer {
  /** Draws the targets in place. Never rejects. */
  /** `fonts` lists extra font folders the site serves (data-fonts). */
  render(targets: Targets, host: Host, fonts?: string): Promise<void>;
}

export interface LoaderOptions {
  document: Document;
  host: Host;
  /** URL of wiredown-renderer.js; see rendererUrl. */
  rendererUrl: string;
  /** Imports the renderer; a dynamic import() by default. */
  load?: (url: string) => Promise<Renderer>;
  /** The loader tag's data-fonts, passed to the renderer. */
  fonts?: string;
}

export const RENDERER = "wiredown-renderer.js";

/** The renderer next to the loader, so a pinned loader gets its own version. */
export function rendererUrl(loaderUrl: string): string {
  return new URL(RENDERER, loaderUrl).href;
}

export const LOAD_FAILED = "Wiredown could not load its renderer; showing the source.";

/** Add a short notice next to content that could not be drawn, leaving it as it was. */
export function notice(element: Element, text: string, where: "before" | "after" = "after") {
  const note = element.ownerDocument.createElement("div");
  note.className = "wiredown-notice";
  note.textContent = text;
  element[where](note);
}

/**
 * Draw the page's wireframes now and whenever the page adds more (comments
 * and previews that arrive after load). Returns a function that stops watching.
 */
export function start(options: LoaderOptions): () => void {
  const { document, host } = options;
  const load =
    options.load ?? ((url: string) => import(/* @vite-ignore */ url) as Promise<Renderer>);
  let renderer: Promise<Renderer> | undefined;
  const scan = () => {
    const blocks = host.findBlocks(document);
    const flow = host.findFlow(document);
    if (!blocks.length && !flow) return;
    for (const block of blocks) block.element.setAttribute(DONE, "");
    flow?.element.setAttribute(DONE, "");
    if (!renderer) {
      renderer = load(options.rendererUrl);
      renderer.catch((error) => console.warn("wiredown: could not load the renderer", error));
    }
    renderer
      .then(
        (r) => r.render(flow ? { blocks, flow } : { blocks }, host, options.fonts),
        () => {
          for (const block of blocks) notice(block.element, LOAD_FAILED);
          if (flow) notice(flow.element, LOAD_FAILED, "before");
        },
      )
      .catch((error) => console.warn("wiredown:", error));
  };
  scan();
  let pending = false;
  const view = document.defaultView;
  const observer = new (view?.MutationObserver ?? MutationObserver)(() => {
    if (pending) return;
    pending = true;
    (view ?? globalThis).setTimeout(() => {
      pending = false;
      scan();
    }, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

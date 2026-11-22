import { check, checkScreens, extendsId, formatError, layoutScreen } from "@wiredown/core";
import type { Screen } from "@wiredown/core";
import { screenElements } from "@wiredown/excalidraw";

/** API subset verified by the prototype against Excalidraw plugin 2.29.0. */
export interface Automate {
  copyViewElementsToEAforEditing(elements: readonly unknown[]): void;
  createSVG(
    template: undefined,
    embedFont: boolean,
    settings: {
      withBackground: boolean;
      withTheme: boolean;
      isMask: boolean;
      skipInliningFonts: boolean;
    },
    loader: undefined,
    theme: string,
    padding: number,
  ): Promise<SVGSVGElement | null>;
  destroy(): void;
}
export interface Section {
  lineStart: number;
  lineEnd: number;
}
export function isVariant(source: string): boolean {
  return extendsId(source) !== null;
}
const normalized = (source: string) => source.replace(/\r\n?/g, "\n").trim();
export function findScreen(screens: Screen[], source: string, section?: Section): number {
  if (section) {
    const index = screens.findIndex(
      (s) => s.line - 1 >= section.lineStart && s.line - 1 <= section.lineEnd,
    );
    if (index >= 0 && normalized(screens[index]!.source) === normalized(source)) return index;
  }
  return screens.findIndex((s) => normalized(s.source) === normalized(source));
}

export const MISSING_PLUGIN =
  "Wiredown needs the Excalidraw plugin. Install and enable it, then reopen this note.";
export function showError(el: HTMLElement, source: string, messages: string[]): void {
  const list = el.ownerDocument.createElement("ul");
  list.className = "wiredown-error";
  for (const message of messages) {
    const li = el.ownerDocument.createElement("li");
    li.textContent = message;
    list.append(li);
  }
  const pre = el.ownerDocument.createElement("pre");
  const code = el.ownerDocument.createElement("code");
  code.textContent = source;
  pre.append(code);
  el.replaceChildren(list, pre);
}

/** Starts before vault/API waits too, so embeds see activity throughout export. */
export function keepBusy(el: HTMLElement): () => void {
  // Excalidraw snapshots after 250 ms + 150 ms of DOM stillness, capped at
  // 2 s. Mutate every 60 ms until export finishes (prototype mechanism).
  const timer = window.setInterval(() => {
    el.dataset.wiredownBusy = String(Date.now());
  }, 60);
  return () => {
    window.clearInterval(timer);
    delete el.dataset.wiredownBusy;
  };
}

export async function renderBlock(
  el: HTMLElement,
  source: string,
  note: string,
  api: () => Promise<Automate | undefined>,
  theme: "light" | "dark",
  section?: Section,
  cache = new Map<string, string>(),
): Promise<void> {
  const block = el.ownerDocument.createElement("div");
  block.className = "wiredown-block";
  el.replaceChildren(block);
  try {
    const all = checkScreens(note);
    const index = findScreen(all.screens, source, section);
    const screen = all.screens[index];
    const local = check(source);
    const belongs = (d: { line: number; screen?: string }) =>
      screen &&
      (d.screen !== undefined
        ? d.screen === screen.id
        : d.line >= screen.line && d.line <= screen.line + screen.source.split("\n").length);
    const errors = screen ? all.errors.filter(belongs) : local.errors;
    const warnings = screen ? all.warnings.filter(belongs) : local.warnings;
    if (errors.length) {
      showError(block, source, errors.map(formatError));
      return;
    }
    const result = screenElements(layoutScreen(screen?.tree ?? local.tree));
    const key = JSON.stringify([result.elements, theme]);
    let text = cache.get(key);
    if (text === undefined) {
      const ea = await api();
      if (!ea) {
        showError(block, source, [MISSING_PLUGIN]);
        return;
      }
      try {
        ea.copyViewElementsToEAforEditing(result.elements);
        // Export light; CSS themes notes and Excalidraw themes image embeds.
        const svg = await ea.createSVG(
          undefined,
          true,
          { withBackground: false, withTheme: true, isMask: false, skipInliningFonts: false },
          undefined,
          "light",
          0,
        );
        if (!svg) throw new Error("Excalidraw returned no SVG");
        svg.removeAttribute("class");
        svg.classList.add("wiredown-svg");
        const style = el.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style");
        style.textContent = ".wiredown-svg{display:block;max-width:100%;height:auto}";
        svg.insertBefore(style, svg.firstChild);
        text = new XMLSerializer().serializeToString(svg);
      } finally {
        ea.destroy();
      }
      // Reuse exports for note/flow embeds within the design's short snapshot
      // window; font embedding on a second export can miss that window.
      if (cache.size > 200) cache.clear();
      cache.set(key, text);
    }
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    const svg = el.ownerDocument.importNode(parsed, true);
    block.dataset.renderer = "excalidraw";
    block.append(svg);
    for (const warning of warnings) {
      const item = el.ownerDocument.createElement("div");
      item.className = "wiredown-warning";
      item.textContent = formatError(warning);
      block.append(item);
    }
  } catch (error) {
    showError(block, source, [
      `Could not draw this wireframe: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

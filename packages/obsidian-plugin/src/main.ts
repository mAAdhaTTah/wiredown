import { FENCE_KEYWORD } from "@wiredown/core";
import { MarkdownRenderChild, Plugin, TFile } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import { isVariant, keepBusy, renderBlock, showError } from "./render.js";
import type { Automate } from "./render.js";

export class Block extends MarkdownRenderChild {
  private generation = 0;
  private stop?: () => void;
  constructor(
    el: HTMLElement,
    private plugin: WiredownPlugin,
    private source: string,
    readonly path: string,
    private ctx: MarkdownPostProcessorContext,
  ) {
    super(el);
  }
  onload(): void {
    this.plugin.blocks.add(this);
  }
  onunload(): void {
    this.generation++;
    this.stop?.();
    this.plugin.blocks.delete(this);
  }
  isVariant(): boolean {
    return isVariant(this.source);
  }
  async draw(): Promise<void> {
    const generation = ++this.generation;
    this.stop?.();
    this.stop = keepBusy(this.containerEl);
    // Render off-DOM so a stale asynchronous draw cannot overwrite a newer one.
    const doc = this.containerEl.ownerDocument;
    const target = doc.createElement("div");
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(this.path);
      const note = file instanceof TFile ? await this.plugin.app.vault.cachedRead(file) : "";
      await renderBlock(
        target,
        this.source,
        note,
        () => this.plugin.api(),
        doc.body.classList.contains("theme-dark") ? "dark" : "light",
        this.ctx.getSectionInfo(this.containerEl) ?? undefined,
        this.plugin.cache,
      );
      if (generation === this.generation)
        this.containerEl.replaceChildren(...Array.from(target.childNodes));
    } catch (error) {
      if (generation === this.generation)
        showError(this.containerEl, this.source, [
          `Could not draw this wireframe: ${error instanceof Error ? error.message : String(error)}`,
        ]);
    } finally {
      if (generation === this.generation) this.stop?.();
    }
  }
}

export default class WiredownPlugin extends Plugin {
  blocks = new Set<Block>();
  readonly cache = new Map<string, string>();
  onload(): void {
    this.registerMarkdownCodeBlockProcessor(FENCE_KEYWORD, (source, el, ctx) => {
      const block = new Block(el, this, source, ctx.sourcePath, ctx);
      ctx.addChild(block);
      return block.draw();
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        for (const block of this.blocks)
          if (block.path === file.path && block.isVariant()) void block.draw();
      }),
    );
  }
  onunload(): void {
    for (const block of this.blocks) block.onunload();
    this.blocks.clear();
  }
  async api(): Promise<Automate | undefined> {
    const plugins = (
      this.app as unknown as {
        plugins?: { plugins?: Record<string, { awaitInit?(): Promise<void> }> };
      }
    ).plugins;
    const plugin = plugins?.plugins?.["obsidian-excalidraw-plugin"];
    if (!plugin) return undefined;
    await plugin.awaitInit?.();
    return (
      window as unknown as { ExcalidrawAutomate?: { getAPI?(): Automate } }
    ).ExcalidrawAutomate?.getAPI?.();
  }
}

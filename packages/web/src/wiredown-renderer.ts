// dist/wiredown-renderer.js: imported by the loader on pages with wireframes.
import type { Host } from "./host";
import type { Targets } from "./loader";
import { render as renderTargets } from "./render";
import type { ExportSvg } from "./render";

declare global {
  var EXCALIDRAW_ASSET_PATH: string | string[] | undefined;
}

let excalidraw: Promise<typeof import("@excalidraw/excalidraw")> | undefined;

/** Excalidraw's browser exporter, loaded only when the page needs rendering. */
export const exportSvg: ExportSvg = async (scene, { theme, padding }) => {
  if (!excalidraw) {
    // Excalidraw loads the fonts it inlines from here: the fonts/ folder
    // shipped next to this file. Set before Excalidraw's module runs.
    globalThis.EXCALIDRAW_ASSET_PATH ??= new URL("./", import.meta.url).href;
    excalidraw = import("@excalidraw/excalidraw");
  }
  const { exportToSvg } = await excalidraw;
  return exportToSvg({
    elements: scene.elements as never,
    appState: {
      ...scene.appState,
      exportBackground: false,
      exportWithDarkMode: theme === "dark",
      exportScale: 1,
    },
    files: scene.files as never,
    exportPadding: padding,
  });
};

export function render(targets: Targets, host: Host, fonts?: string): Promise<void> {
  return renderTargets(targets, host, exportSvg, document, fonts).catch((error) =>
    console.warn("wiredown:", error),
  );
}

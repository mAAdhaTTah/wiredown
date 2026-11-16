import type { ExcalidrawElementJson } from "./elements.js";

export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElementJson[];
  appState: { viewBackgroundColor: string };
  files: Record<string, never>;
}

/** The scene object Excalidraw's exporters take. */
export function sceneOf(elements: ExcalidrawElementJson[]): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "wiredown",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

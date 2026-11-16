# @wiredown/excalidraw

Turns a screen laid out by `@wiredown/core` into plain Excalidraw element
JSON. The main entry imports no Excalidraw runtime or DOM library:
Excalidraw draws the elements in whichever host exports them, so strokes,
the font and dark mode are Excalidraw's own. Elements are always for the
light theme.

```ts
import { layoutScreen, parse } from "@wiredown/core";
import { sceneOf, screenElements } from "@wiredown/excalidraw";

const layout = layoutScreen(parse("button: Save #save").tree);
const { elements, width, height, boxes } = screenElements(layout, { idPrefix: "save" });
const scene = sceneOf(elements);
```

## API

Flows are Obsidian Excalidraw drawings (`flows/<name>.excalidraw.md`).
`parseFlow` reads one into `{ elements, appState, files, embeds }`;
`serializeFlow` writes it back, regenerating `## Text Elements`,
`## Embedded Files` and the drawing JSON from the scene and keeping
everything else (frontmatter, other sections, unknown fields, a compressed
drawing's form) as read. `newFlow` is an empty drawing.

```ts
import { formatEmbed, parseFlow, serializeFlow } from "@wiredown/excalidraw";

const flow = parseFlow(text);
flow.embeds.set(fileId, { path: "screens", blockId: "home", width, height });
const next = serializeFlow(flow); // "screens#^home|WxH" via formatEmbed
```

Node SVG export is available separately; heavy dependencies load on first
render. Both functions accept `{ theme?: "light" | "dark", fonts?: boolean }`,
defaulting to light with embedded Excalifont.

```ts
import { renderScreenSvg, renderSvg } from "@wiredown/excalidraw/node";

const svg = await renderSvg(elements);
const rendered = await renderScreenSvg(parse("button: Save #save").tree);
// rendered: { svg, width, height, boxes }
```

The Node entry uses a private happy-dom document and lazily installs a
`FontFace` stub only if the host has none. No global window or document is
installed. The pinned exporter cannot subset the font in Node, so it embeds
the whole font; the Node entry drops the message Excalidraw logs about that
while it exports. Layout uses core's metrics, without DOM text measurement.

The Node entry needs Node 22.12 or later. It is an ES module; CommonJS can
`require()` it.

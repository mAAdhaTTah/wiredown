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
installed. The pinned exporter logs a font-set warning and a glyph-subsetting
warning in Node; it still embeds the full Latin font subset, as verified by
the export tests. Layout uses core's metrics, without DOM text measurement.

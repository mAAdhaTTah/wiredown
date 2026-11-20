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

The root export renders nothing; SVG export is in the Node entry,
`@wiredown/excalidraw/node`, below.

- **Elements** (`elements`): `screenElements(layout, options?)` takes core's
  `LayoutResult` (from `layoutScreen` or `layout`) and returns
  `ScreenElements`:
  - `elements`: `ExcalidrawElementJson[]`. The first is an invisible
    frame rectangle that fixes the export's size; then one element per
    draw op: a rectangle, an ellipse, a line (ops with fewer than two
    points are skipped) or text in Excalifont at the line height layout
    measured with. Colours are for the light theme; Excalidraw applies
    dark mode at export.
  - `width` and `height`: the exported image's size, padding included,
    rounded up to whole px.
  - `boxes`: layout's `Box` for each `#id`, moved into the image's
    coordinates (0,0 is its top-left), so flow overlays can be placed by
    scaling them.

  A screen that draws nothing gives no elements, size 0 and no boxes.
  `ElementOptions` are all optional: `idPrefix` (default `wf`; element ids
  are `<prefix>-<n>`, so several screens can share a scene), `padding`
  around the drawing (default 8) and Excalidraw `roughness` (0 architect,
  1 artist, 2 cartoonist; default 1). Ids and seeds come from each
  element's position in the list, so the same screen always gives the
  same elements. `EXCALIFONT_FAMILY` is Excalidraw's font family number for
  Excalifont (5).

- **Scene** (`scene`): `sceneOf(elements)` wraps elements in the
  `ExcalidrawScene` object Excalidraw's exporters take, with a white
  background and no files.
- **Types**: `ElementOptions`, `ScreenElements`, `ExcalidrawElementJson`
  (an element as a plain object with at least `id` and `type`) and
  `ExcalidrawScene`.

## Node API

`@wiredown/excalidraw/node` exports through Excalidraw in Node. Its heavy
dependencies load on first render.

- **SVG** (`node`): `renderSvg(elements, options?)` exports the adapter's
  light-theme elements and resolves to the SVG markup.
  `renderScreenSvg(tree, options?)` lays a parsed screen out with core's
  `layoutScreen`, builds its elements with the default `ElementOptions` and
  exports them, resolving to `{ svg, width, height, boxes }`: the SVG and
  `screenElements`' size and boxes.
- **Types** (`node`): `SvgOptions`, which both take: `theme` (`"light"` or
  `"dark"`; default light) and `fonts` (inline Excalifont so the SVG is
  portable; default true).

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

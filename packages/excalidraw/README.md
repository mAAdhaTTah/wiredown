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
- **Flows** (`flow`): flows are Obsidian Excalidraw drawings
  (`flows/<name>.excalidraw.md`). `parseFlow(text)` reads one into a
  `Flow`, `{ elements, appState, files, embeds }`, and throws if the text
  is not one; `serializeFlow(flow)` writes it back, regenerating
  `## Text Elements`, `## Embedded Files` and the drawing JSON from the
  scene and keeping everything else (frontmatter, other sections, unknown
  fields) as read. `newFlow()` is an empty drawing. Compressed drawings can
  be read, but writes always use diffable JSON. The flow exposes
  `compressed` to identify compressed input. Turn off "Compress Excalidraw
  JSON in Markdown" in the Excalidraw plugin's Saving settings to keep
  drawings diffable.

  `embeds` maps an image's `fileId` to its `## Embedded Files` link, an
  `EmbedLink`: `path`, and optionally `blockId` (`#^id`, as for a screen),
  `heading` (`#Heading`), `width` and `height`; `serializeFlow` writes it
  in the Obsidian plugin's link grammar. A flow's `source` is a `FlowSource`,
  opaque to callers: what `serializeFlow` needs to reproduce the parts it
  does not own.

  ```ts
  import { parseFlow, serializeFlow } from "@wiredown/excalidraw";

  const flow = parseFlow(text);
  flow.embeds.set(fileId, { path: "screens", blockId: "home", width, height });
  const next = serializeFlow(flow); // writes [[screens#^home|WxH]]
  ```

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
installed. The pinned exporter logs a font-set warning and a glyph-subsetting
warning in Node; it still embeds the full Latin font subset, as verified by
the export tests. Layout uses core's metrics, without DOM text measurement.

`addScreen(flow, { screenId, title, path, size, place? })` appends a label
and image and returns its F-number; `size` is the rendered screen size.
`embedSize(width, height)` converts a screen export size to `{ link, image }` dimensions. `flowFrames(flow)`
finds live images with Wiredown customData. Legacy labels reserve numbers,
but legacy images are not placement targets. Deleted elements reserve their
numbers too. Existing elements are never changed. A frame's label and image
carry an `anchor` naming the image element and share a new Excalidraw
group, recorded as `group` in the image's
`customData.wiredown`. Every `customData.wiredown` carries `v`
(`DATA_VERSION`, now 1); data without `v` is version 1, and data with a
higher `v` is ignored. New elements also carry `id`, equal to the element's
id. Data naming a different element belongs to a person's pasted copy and
is ignored by flow commands, though its F-number stays taken. Existing data
without `id` keeps its previous behaviour; writes do not migrate it.

An embed's path names its screens file within a root, a directory URL
ending in `/`: the git repository's root, else the Obsidian vault's, else
the folder above the nearest `flows/` folder, else the parent of the flow's
directory (on a forge, the repository's raw-content root). Locations are
URLs, `file:` ones in Node. `embedPathFor(screensUrl, root)` is the path to
write, the file's path from the root without `.md`, such as
`docs/checkout/screens`; undefined for a file outside the root.
`embedCandidates(flowUrl, embedPath, root)` lists where the file may be:
for `./x` or `../x` only that file from the flow's directory; otherwise the
path from the root first, then the path from the flow's directory and each
one above it, nearest first. It is undefined for a path that is absolute,
has a `..` segment without starting `./` or `../`, or normalises outside the
root. `resolveEmbedPath(flowUrl, embedPath, exists, root)` returns `{ url }`
for the first candidate that `exists` (a fetch in the browser),
`{ outside: true }`, or undefined. The CLI, which can list the root, instead
matches a path not found from the root against the end of every `.md`
file's path and refuses more than one match.

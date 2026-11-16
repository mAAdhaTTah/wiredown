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
  `Flow`, `{ elements, appState, files, embeds }`, and throws a
  `FlowError` if the text is not one; `serializeFlow(flow)` writes it back, regenerating
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

- **Flow commands** (`flow-edit`): `addScreen(flow, options)` appends a frame,
  a label (`F1 · <title>`) and an image, and returns its F-number. Its
  `AddScreenOptions` are `screenId`, `title`, `path` (the embed path), `size`,
  the rendered screen size, and an optional `place` (below).
  `embedSize(width, height)` converts a screen export size to `{ link, image }`
  dimensions. `flowFrames(flow)` finds live images with Wiredown customData, as
  `{ frame, element }`. Legacy labels reserve numbers, but legacy images are not
  placement targets. Deleted elements reserve their numbers too. A frame's label
  carries an `anchor` naming its image element. The label and image share a new
  Excalidraw group, recorded as `group` in the image's `customData.wiredown`.

  Frames (F1, F2, ...) and decisions (D1, D2, ...) are the flow's nodes;
  `flowNodes(flow)` lists the live ones as `FlowNode`s,
  `{ node, kind, element }`.

  - `addDecision(flow, { text, place? })` appends a diamond with its text
    centred inside and returns its D-number; the diamond grows if the
    wrapped text does not fit. Its options are `AddDecisionOptions`.
  - `connect(flow, from, to, { label? })` appends a straight arrow between
    the facing edges of two nodes, where they are now, bound at both ends,
    with an optional bound-text label (`ConnectOptions`); it returns the
    arrow's element id. Further arrows between the same pair are offset so
    they do not overlap.
  - `addNote(flow, node, text)` appends a free grey text under a frame or to
    the right of a decision (below its earlier notes), wrapped to the node's
    width, and returns its id. The note takes the node's Excalidraw groups from
    ours outward, so it moves with the node and stays inside any group a person
    put the node in; a decision gets its group (diamond and text) on its first
    note, inserted innermost.

  A `Place` is `{ rightOf: "F2" }` or `{ below: "D1" }`; without one, a new
  node goes right of the rightmost node. Unknown nodes throw a `FlowError`
  and change nothing. Existing elements are never moved or restyled; `connect` only
  adds the arrow to its two nodes' `boundElements`, as Excalidraw's binding
  requires, and a note may add the group to its node. A person's pasted
  copy of a node (its data's `id` names another element) is not a node:
  nothing attaches to it, placement ignores it, and its name stays taken.
  Two live nodes with one name (data without `id`, or edited by hand) make
  every command that takes that name throw a `FlowError`, naming both
  element ids.

  Flow overlays use exported screen boxes and the image's current geometry:
  `overlayBox(image, screenSize, box)` returns `{ x, y, width, height }`.
  `addHighlight(flow, frame, { target, box, screen })` returns an outline id;
  `addMark(flow, frame, { target, box, screen, label })` returns the circle id,
  with its text bound to it. Their `OverlayOptions` are the `target` id, its
  `box` from `screenElements` and the `screen`'s `{ width, height }`. Highlights
  have a 4px outset; badges are at least 32px wide, else the size Excalidraw
  gives an ellipse around their label, so it does not resize them.
  A badge's centre is `markCentre(x, y, diameter)`: up and left of the
  component's top-left corner by a third of its diameter, so it sits just
  outside the corner. Neither is bound to the image; both join the frame's
  group. `frameImage(flow, frame)` is a frame's image element. Overlays record
  `{ v: 1, id, role: "highlight" | "mark", frame, screen, target, label?, anchor }`
  in `customData.wiredown`, where `anchor` is the frame image's element id and
  `frame` is for people; bound text has the same data (with its own `id`) and
  role `label`. Duplicate highlights or identical mark labels on one component
  throw; a person's copy of an overlay is not one of ours.

  Embeds are sized for the Excalidraw plugin's default Markdown embed, as
  measured in Obsidian: 10px host padding on each side, a 2px border on
  every side, a 5px footer. Those constants in `flow-edit.ts` set both
  sizing and overlays. With the plugin's border turned off, the plugin
  reshapes frames on open (issue #42).

  Every `customData.wiredown` carries `v` (`DATA_VERSION`, now 1); data
  without `v` is version 1, and data with a higher `v` is ignored.
  `newerDataVersion(flow)` is the version of live elements from a newer
  wiredown: the highest number, else the first value; undefined when there
  are none. New elements also carry `id`, equal to the element's id. Data
  naming a different element belongs to a person's pasted copy and is
  ignored by flow commands, though its F-number stays taken. Existing data
  without `id` keeps its previous behaviour; writes do not migrate it.
  Every element records itself in `customData.wiredown`, with `v: 1` and
  its own `id`: frames as `{ frame, screen, role: "screen" | "label" }`
  (the image adds `group`), decisions as
  `{ node, role: "decision" | "label" }` (the diamond adds `group` once it
  has one), arrows as `{ role: "arrow", from, to, slot? }`, where `slot` is
  the arrow's place among the arrows between its pair, 1 for the first
  offset one (their labels `role: "label"`), notes as
  `{ role: "note", node, anchor }` where `anchor` is the node's element id.

- **Lint and refresh** (`flow-refresh`): `lintFlow(flow, screens)` and
  `refreshFlow(flow, screens)` compare a flow with the screens it embeds as
  they lay out now. `screens` is a `ScreenLookup`: asked per embed with a
  `ScreenRef`, `{ path, blockId }` (the path as written in the link, so two
  screens files with one block id are never confused), it returns
  `{ ok: true, screen }`, where `screen` is a `ScreenState`,
  `{ width, height, boxes }` from `screenElements`, or
  `{ ok: false, message }` saying why there is none. The message stands
  alone (`ui.md has no ^team`); findings add
  `embeds [[path#^id]], but <message>`.

  `lintFlow` returns `FlowFinding`s, `{ message, frame?, element? }`: missing
  screens, stale embed sizes or image aspect (a uniformly scaled frame is fine),
  two nodes claiming one name, two nodes whose boxes overlap (touching edges do
  not), a person's copies of our elements (one finding per set pasted together),
  stale overlays, ones whose target or frame is gone or that were drawn for
  another screen, notes whose node is gone, notes whose top edge lies inside
  their frame, straight arrows of ours whose ends are more than 12px from where
  `connect` would put them now or inside a frame (Excalidraw moves ends bound
  to a diamond by up to 6px when it opens the drawing), dangling arrow or text bindings
  (`bindingFailures(elements)` on its own), images without an
  `## Embedded Files` entry, and data from a newer wiredown. Overlays belong to
  the frame whose image id their `anchor` records.

  `refreshFlow` updates each frame's link size and image size (same top-left and
  scale), moves its overlays to where `addHighlight` and `addMark` would place
  them, and moves the notes under it (those overlapping it sideways with their
  top below its old top) by the change in its bottom edge, or, when the top one
  overlaps the frame, to 20px under it, keeping their order. It then re-routes
  each two-point arrow of ours whose ends are off with the geometry `connect`
  uses, keeping the arrow's slot, id and bindings' mode, and places its label as
  `connect` does (halfway, or a third along when the pair has parallel arrows).
  Displaced labels and notes return to their places. Bent arrows, decisions and
  hand-drawn elements never move. Frames are not moved apart, so a frame that
  grew may overlap its neighbour. It returns `FlowChange`s:
  `{ frame, kind: "embed", element, link, image }` (each a `{ from, to }` of
  `Size`s, `{ width, height }`),
  `{ frame, kind: "highlight" | "mark", element, target, label?, textId?, unresolved? }`
  (`textId` is a mark's text element),
  `{ frame, kind: "note" | "label", element }` for a note moved or a displaced
  label or note returned,
  `{ frame, kind: "arrow", element, from, to, unresolved? }`, and
  `{ frame, kind: "group", element, part, group }` for a frame's part put back
  in its group. Each also has `x`, `y`, `width` and `height`: the element's
  geometry as refresh leaves it. `unresolved` says why an overlay, or a bent
  arrow that no longer meets its node, was left in place. It throws, changing nothing, when two nodes claim
  one name. A flow that `lintFlow` finds nothing in is one `refreshFlow` leaves
  untouched.

  Lint reports labels more than 60 px from their place above the frame.
  Notes stay in the stack within 60 px horizontally and with a vertical gap
  of at most 200 px from the node or previous in-place note, leaving room
  for a deleted note. They may overlap that edge by up to 60 px. Refresh
  returns displaced notes after the retained stack in vertical order, under
  a frame or beside a decision. It restores groups only on parts with no
  group; personal groups and small hand nudges stay untouched. Far notes
  beside a decision are handled the same way. A label or note with a group
  absent from its node is left untouched and does not take a place in the
  note stack.

- **Screens paths** (`screens-path`): an embed's path names its screens file
  within a root, a directory URL ending in `/`: the git repository's root, else
  the Obsidian vault's, else the parent of the flow's directory (on a forge,
  the repository's raw-content root). Locations are URLs, `file:` ones in Node.
  `embedPathFor(screensUrl, root)` is the path to write, the file's path from
  the root without `.md`, such as `docs/checkout/screens`; undefined for a file
  outside the root. `isRelativeEmbed(path)` says whether a path is relative to
  the flow's directory (`./x`, `../x`).
  `embedCandidates(flowUrl, embedPath, root)` lists where the file may be: for
  `./x` or `../x` only that file from the flow's directory; otherwise the path
  from the root first, then the path from the flow's directory and each one
  above it, nearest first. It is undefined for a path that is absolute, has a
  `..` segment without starting `./` or `../`, or normalises outside the root.
  `resolveEmbedPath(flowUrl, embedPath, exists, root)` returns
  `{ ok: true, url }` for the first candidate that `exists` (a fetch in the
  browser), else `{ ok: false, reason }`, `reason` being `"outside"` or
  `"missing"`. The CLI, which can list the root, instead matches a path not
  found from the root against the end of every `.md` file's path and refuses
  more than one match. `embedNotFound(embedPath, flowDir, root)` says why a path
  did not resolve: `no ../ui.md was found from <dir>` for a relative path, else
  `no ui.md was found in <root>`.

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

  `renderFlowSvg(flow, screens, options?)` exports a flow, returning
  `{ svg, width, height, missing, rejected }`. The lookup is asked per embed,
  `screens({ path, blockId })`, and returns adapter elements or `undefined`;
  missing entries contain `element`, `path` and `blockId`. Screen SVGs are
  cached by embed path and block id, padded using `embedSize`, and supplied as
  SVG data URLs alongside existing drawing files. Nested screens inline their
  own fonts unless `fonts: false`. Excalidraw filters light SVG images for dark
  flows, so nested screens are always exported light. A drawing file that is not
  an inline PNG, JPEG, GIF, WebP or SVG data URL is left out and listed in
  `rejected` as `{ id, reason }`.

- **Types** (`node`): `SvgOptions`, which the SVG functions take: `theme`
  (`"light"` or `"dark"`; default light) and `fonts` (inline Excalifont so
  the SVG is portable; default true).

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
`embedSize(width, height)` converts a screen export size to `{ link, image }`
dimensions. `flowFrames(flow)` finds live images with Wiredown customData.
Legacy labels reserve numbers, but legacy images are not placement targets.
Deleted elements reserve their numbers too. A frame's label carries an
`anchor` naming its image element. The label and image share a new
Excalidraw group, recorded as `group` in the image's
`customData.wiredown`. Every `customData.wiredown` carries `v`
(`DATA_VERSION`, now 1); data without `v` is version 1, and data with a
higher `v` is ignored. New elements also carry `id`, equal to the element's
id. Data naming a different element belongs to a person's pasted copy and
is ignored by flow commands, though its F-number stays taken. Existing data
without `id` keeps its previous behaviour; writes do not migrate it.

Frames (F1, F2, ...) and decisions (D1, D2, ...) are the flow's nodes;
`flowNodes(flow)` lists the live ones as `{ node, kind, element }`.

- `addDecision(flow, { text, place? })` appends a diamond with its text
  centred inside and returns its D-number.
- `connect(flow, from, to, { label? })` appends a straight arrow between the
  facing edges of two nodes, where they are now, bound at both ends, with an
  optional bound-text label; it returns the arrow's element id. Further
  arrows between the same pair are offset so they do not overlap.
- `addNote(flow, node, text)` appends a free grey text under a node (below
  its earlier notes), wrapped to the node's width, and returns its id. The
  note takes the node's Excalidraw groups from ours outward, so it moves
  with the node and stays inside any group a person put the node in; a
  decision gets its group (diamond and text) on its first note, inserted
  innermost.

`place` is `{ rightOf: "F2" }` or `{ below: "D1" }`; without it, a new node
goes right of the rightmost node. Unknown nodes throw and change nothing.
Existing elements are never moved or restyled; `connect` only adds the
arrow to its two nodes' `boundElements`, as Excalidraw's binding requires,
and a note may add the group to its node. A person's pasted copy of a node
(its data's `id` names another element) is not a node: nothing attaches to
it, placement ignores it, and its name stays taken. Two live nodes with one
name (data without `id`, or edited by hand) make every command that takes
that name throw, naming both element ids. Every element records itself in
`customData.wiredown`, with `v: 1` and its own `id`: frames as `{ frame,
screen, role: "screen" | "label" }` (the image adds `group`), decisions as
`{ node, role: "decision" | "label" }` (the diamond adds `group` once it
has one), arrows as `{ role: "arrow", from, to,
slot? }`, where `slot` is the arrow's place among the arrows between its
pair, 1 for the first offset one (their labels `role: "label"`), notes as
`{ role: "note", node, anchor }` where `anchor` is the node's element id.

Flow overlays use exported screen boxes and the image's current geometry:
`overlayBox(image, screenSize, box)` returns `{ x, y, width, height }`.
`addHighlight(flow, frame, { target, box, screen })` returns an outline id;
`addMark(flow, frame, { target, box, screen, label })` returns the circle id,
with its text bound to it. Highlights have a 4px outset; badges are at least
32px wide and grow to fit their label. A badge's centre is `markCentre(x, y,
diameter)`: up and left of the component's top-left corner by a third of
its diameter, so it sits just outside the corner. Neither is bound to the
image; both join the frame's group. `frameImage(flow, frame)` is a frame's
image element. Overlays record `{ v: 1, id, role: "highlight" | "mark",
frame, screen, target, label?, anchor }` in `customData.wiredown`, where
`anchor` is the frame image's element id and `frame` is for people; bound
text has the same data (with its own `id`) and role `label`. Duplicate
highlights or identical mark labels on one component throw; a person's
copy of an overlay is not one of ours.

`lintFlow(flow, screens)` and `refreshFlow(flow, screens)` compare a flow with
the screens it embeds as they lay out now. `screens({ path, blockId })` is asked
per embed (the path as written in the link, so two screens files with one block
id are never confused) and returns `{ width, height, boxes }` from
`screenElements`, or a string saying why there is none. `lintFlow` returns
findings `{ message, frame?, element? }`: missing screens, stale embed sizes or
image aspect (a uniformly scaled frame is fine), two nodes claiming one name
(`claimedNames`), two nodes whose boxes overlap (touching edges do not), a
person's copies of our elements (`pastedCopies`: one finding per set pasted
together), stale overlays, ones whose target or frame is gone or that were drawn
for another screen, notes whose node is gone, notes whose top edge lies inside
their frame, straight arrows of ours whose ends are more than 1px from where
`connect` would put them now, dangling arrow or text bindings
(`bindingFailures(elements)` on its own), images without an `## Embedded Files`
entry, and data from a newer wiredown. Overlays belong to the frame whose image
id their `anchor` records. `refreshFlow` updates each frame's link size and
image size (same top-left and scale), moves its overlays to where `addHighlight`
and `addMark` would place them, and moves the notes under it (those overlapping
it sideways with their top below its old top) by the change in its bottom edge,
or, when the top one overlaps the frame, to 20px under it, keeping their order.
It then re-routes each two-point arrow of ours whose ends are off with the
geometry `connect` uses, keeping the arrow's slot, id and bindings' mode, and
places its label as `connect` does (halfway, or a third along when the pair has
parallel arrows). Displaced labels and notes return to their places. Bent
arrows, decisions and hand-drawn elements never move. Frames are not moved
apart, so a frame that grew may overlap its neighbour. It returns `{ frame,
kind: "embed", element, link, image }`, `{ frame, kind: "highlight" | "mark",
element, target, label?, unresolved? }`, `{ frame, kind: "note", element }` and
`{ frame, kind: "arrow", element, from, to, unresolved? }` changes, where
`unresolved` says why an overlay, or a bent arrow that no longer meets its
node, was left in place. It throws, changing nothing, when two nodes claim one
name. A flow that `lintFlow` finds nothing in is one `refreshFlow` leaves untouched.

Embed alignment in Obsidian remains unverified. Padding assumptions live in
`flow-edit.ts`'s existing embed constants: 10px on each side, zero above,
5px footer below. Changing those constants corrects sizing and overlays.

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

Lint reports labels more than 60 px from their place above the frame. Notes stay
in the stack within 60 px horizontally and with a vertical gap of at most 200 px
from the node or previous in-place note, leaving room for a deleted note. They
may overlap that edge by up to 60 px. Refresh returns displaced notes after the
retained stack in vertical order, under a frame or beside a decision. It
restores groups only on parts with no group; personal groups and small hand
nudges stay untouched. Far notes beside a decision are handled the same way. A
label or note with a group absent from its node is left untouched and does not
take a place in the note stack.

The Node entry exports `renderFlowSvg(flow, screens, options?)` (options as
for `renderSvg`, plus `raster`, below), returning
`{ svg, width, height, missing, inline }`. The lookup is asked per embed,
`screens({ path, blockId })`, and returns adapter elements or `undefined`;
missing entries contain `element`, `path` and `blockId`. Screen SVGs are
cached by embed path and block id, padded using `embedSize`, and supplied as SVG data
URLs alongside existing drawing files. Nested screens inline their own
fonts unless `fonts: false`. Excalidraw filters light SVG images for dark
flows, so nested screens are always exported light.

### PNG

`svgToPng(svg, { scale?, background?, inline? })` rasterises an SVG from the
functions above with `@resvg/resvg-js` (native, prebuilt for Linux, macOS
and Windows; loaded on first use, no browser) and resolves to
`{ png, width, height }`: the PNG bytes and their size in pixels, the SVG
size times `scale` (default 1). It is transparent unless `background` (a
CSS colour) is given; `BACKGROUND.light` (`#ffffff`) and `BACKGROUND.dark`
(`#121212`, white as Excalidraw's dark mode draws it) match the canvas
behind each theme. The same SVG gives the same bytes on the same machine.

```ts
import { BACKGROUND, renderScreenSvg, svgToPng } from "@wiredown/excalidraw/node";

const { svg } = await renderScreenSvg(tree, { theme: "dark" });
const { png, width, height } = await svgToPng(svg, { scale: 2, background: BACKGROUND.dark });
```

resvg ignores `@font-face`, so `svgToPng` takes the Excalifont woff2 files
the SVG embeds (in the SVG and in its nested screen images), decompresses
them to TrueType with `woff2-encoder`, and hands them to resvg as font files
in a temporary directory. Export with fonts (the default) for PNGs: without
them text falls back to a system font. Characters Excalifont lacks are drawn
with a system font that has them; if none does, resvg draws an empty box,
so their look depends on the machine (`check` warns about them).
Excalidraw draws images as a `<use>` of a `<symbol>`; resvg sizes those
wrongly and draws no text inside nested SVG images, so `svgToPng` inlines
into its symbol each SVG image whose data URL is in `inline`, the set
`renderFlowSvg` returns for the screens it generated. The SVG output itself
is unchanged. An SVG image can make resvg read local files (through an
image, an `feImage`, a pattern), so for PNG output pass `raster: true` to
`renderFlowSvg`: the drawing's own SVG images are then listed in `rejected`
and not drawn, while its PNG, JPEG, GIF and WebP images are. `svgToPng`
throws ("refusing an SVG image that is not one of the trusted screens") on
any data URL other than a trusted screen, a raster image or a font.
`svgToPng` does not inspect the SVG's own links, so an `<image href="/path">`
in the SVG you pass is read from disk; pass only SVGs from this module's
exporters. In SVG output a drawing's SVG images stay embedded as inert
image data.

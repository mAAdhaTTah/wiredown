# @wiredown/cli

The `wiredown` command: checks and renders the screens in a Markdown file
headlessly in Node, with JSON output for agents.

```sh
wiredown check <file.md>... [--json]
wiredown lint [<path>...] [--exclude <glob>]... [--json]
wiredown skill [<dir>] [--json]
wiredown render <file.md> [--screen <id>]... [--out <dir>] [--format svg|png] [--scale <n>]
                [--transparent] [--theme light|dark] [--no-fonts] [--json]
wiredown --help | <command> --help | flow <command> --help | --version
```

`check` prints its findings on stdout: they are its result. `render` prints
the files it wrote on stdout and its findings on stderr. With `--json`,
stdout is one JSON document and stderr is empty.

Exit codes: 0 success; 1 the file has errors, a screen could not be
written, or `render` had nothing to render; 2 bad usage or an unreadable file, with a message on stderr and
nothing on stdout, even with `--json`. Any other error is a bug: Node
prints its stack trace and exits 1.

A finding is `{ line?, message, screen? }`: the 1-based line in the file,
when it has one, and the `^id` of the screen it belongs to, when known.
Printed, it reads `path:line: ^id: error: message` (or `warning:`); without
a line it reads `path: ^id: error: message`.

## check

Checks every `wiredown` block in each file, resolving variants. Prints one
line per finding and a summary line per file. Exits 1 if any file has
errors; warnings don't fail. A file with no `wiredown` blocks gets the
warning `no wiredown blocks`, with no line.

```json
{
  "files": [
    {
      "file": "screens.md",
      "screens": [{ "id": "team-members", "heading": "Team members", "line": 4 }],
      "errors": [],
      "warnings": []
    }
  ]
}
```

A screen's `id` and `heading` are omitted when it has none; `line` is the
first line of the block's content.

## render

Renders every screen with an `^id`, or only the `--screen` ids, to
`<out>/<id>.svg` (`--out` defaults to `.` and is created if missing).
Variants render resolved. Screens without an id are skipped with a warning.
A screen with errors is not rendered: its errors are reported as `check`
reports them, the other screens still render, and the exit code is 1. An
unknown `--screen` id is an error that lists the ids in the file. A file
with no screen with an id is the error `no screens with an ^id to render`.

Without `--json`, stdout has one `path  WxH` line per written file and the
findings go to stderr. With `--json`:

```json
{
  "file": "screens.md",
  "screens": [
    {
      "id": "team-members",
      "svg": "out/team-members.svg",
      "width": 528,
      "height": 328,
      "boxes": { "invite": { "x": 278.8, "y": 60, "w": 147.2, "h": 40 } }
    }
  ],
  "errors": [],
  "warnings": []
}
```

`width` and `height` are the image's size, for sizing flow embeds. `boxes`
holds the box of each `#id` in the screen, in image coordinates. The
findings are those of the rendered screens plus any outside a screen; the
errors for an unknown `--screen` id and for nothing to render have no
`line`.

The document also has `"format": "svg"` (or `"png"`) at the top level.

`--theme dark` lets Excalidraw draw the dark theme; file names don't change,
so pick another `--out`. `--no-fonts` leaves Excalifont out of the SVG.

### PNG

`--format png` writes `<out>/<id>.png` (or `<out>/<name>.png` for a flow)
instead of SVG; one format per run. PNGs are rasterised in Node by resvg,
with no browser, from the same SVG, so they look like it: Excalifont text,
hand-drawn strokes, the theme's colours and, in flows, the embedded
screens. The same input gives byte-identical PNGs on the same machine.
In a PNG, SVG images supplied by the drawing (not its screens) are not
drawn, since they could make the rasteriser read local files, and neither
are raster images whose data URL is not plain base64; each is reported
like any rejected image file (exit 1, the PNG still written). Other raster
images are drawn. In SVG output all of them stay embedded as inert image
data.

- `--scale <n>`, a whole number from 1 to 4 (default 2), multiplies the
  pixel size, so text stays legible.
- The background is the theme's canvas colour: white (`#ffffff`) for light,
  and `#121212`, Excalidraw's dark canvas (its white through the dark-mode
  filter), for dark. `--transparent` keeps the SVG's transparency instead.
- `--scale` and `--transparent` need `--format png`; `--no-fonts` is SVG
  only, since a PNG always draws its text in Excalifont.

In the JSON the path key is the format, and the pixel size is added next to
the SVG size; `width` and `height` keep their meaning, the image size flow
embeds use:

```json
{
  "file": "screens.md",
  "format": "png",
  "screens": [
    {
      "id": "team-members",
      "png": "out/team-members.png",
      "width": 528,
      "height": 328,
      "pixelWidth": 1056,
      "pixelHeight": 656,
      "boxes": { "invite": { "x": 278.8, "y": 60, "w": 147.2, "h": 40 } }
    }
  ],
  "errors": [],
  "warnings": []
}
```

A flow's is `{ file, format, flow: { png, width, height, pixelWidth,
pixelHeight }, errors, warnings }`. Without `--json` each line is
`out/team-members.png  528x328  (1056x656 px)`. A PNG that can't be
written is an error finding, as for SVG, and the exit code is 1.

Characters missing from Excalifont (`check` warns about them, for example
`⋯`, `✓` or `▾`) change how a whole text element looks in a PNG: resvg
draws every character of that element in a system font that has the
missing one, so the text is wider than laid out and can be cut at the
screen's edge. Which font it picks depends on the machine; with no such
font, the characters come out as empty boxes. Use text Excalifont has when
the PNG matters.

## lint

`wiredown lint [<path>...] [--exclude <glob>]... [--json]` is the check for
CI. Each path is a file or a directory, walked recursively, skipping
`node_modules` and dot-directories; with no paths it lints `.`. Each
`--exclude` glob is matched against paths relative to the working
directory; a matching file is skipped and a matching folder is not walked,
for example `--exclude 'docs/**/prd.md'` for specs that have no screens. It runs `flow lint` on every
`*.excalidraw.md` (each frame's screens file is the one its embed names,
resolved as the `flow` commands do) and `check` on every other Markdown
file, so one without wiredown blocks gets `check`'s warning. The report is
`check`'s
and `flow lint`'s, one after the other; exit 1 if any screen has errors or
any flow has findings (screen warnings don't fail). With `--json`:

```text
{ screens: [<check's per-file objects>], flows: [{ file, findings }] }
```

In a GitHub Actions workflow of a repo with screens and flows (while the
package is private, the registry needs a read token):

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
- run: npx --yes @wiredown/cli lint
```

## skill

`wiredown skill [<dir>] [--json]` installs the agent skill that ships with
this package (`dist/skills/wiredown`) in a project: it copies it to
`<dir>/.agents/skills/wiredown` (`dir` defaults to `.`), replacing an
earlier copy, and links it from `<dir>/.claude/skills/wiredown` and from
`<dir>/<folder>/skills/wiredown` for every other dot-folder that has a
`skills` folder, such as `.windsurf`. Run it again after upgrading. Human
output is the copy's path, then one `<link> -> <copy>` line per link. JSON
is `{ skill, links }`. A folder that cannot be read is a usage error (exit
2); a failed write exits 1, with the message on stderr (JSON:
`{ skill: null, links, errors }`, `links` being those already written).

## flow

`wiredown flow new <flow.excalidraw.md> [<screen-id>... --screens
<screens.md>] [--json]` creates an empty drawing or a row of frames, each
connected to the next by an unlabelled arrow (F1 -> F2 -> F3); an existing
file is an error.

`wiredown flow add-screen <flow.excalidraw.md> <screen-id> --screens
<screens.md> [--right-of F2 | --below F2] [--title <text>] [--json]` appends
a frame relative to the current position of a node. Default placement is
right of the rightmost node. Titles default to the screen heading, then its id.

Each frame embeds its screen as `[[<path>#^<id>|WxH]]`, and that path says
which screens file the frame uses. The path written is the screens file's
path from the flow's root without `.md`, such as `docs/checkout/screens`.
The root is the git repository's root (the nearest directory at or above
the flow holding `.git`), else the Obsidian vault's (holding `.obsidian/`),
each looked for above the flow's path and then above its real path; else
the parent of the flow's directory. Readers take:

- `./x` and `../x` from the flow's directory;
- any other path from the root, if that file exists;
- else, as Obsidian does, the one `.md` file in the root whose path ends
  with it (`screens`, `checkout/screens`), not searching `node_modules` or
  folders starting with `.`. More than one is an error naming them
  (`screens matches several files: a/screens.md, b/screens.md; …`).

A path that is absolute, has a `..` segment without starting `./` or `../`,
or leads outside the root (a symlink included) is rejected:
`../outside points outside <root>`. One flow can embed screens from several
files.

A screens file or root found from the flow is printed relative to the
working directory when the flow's path was given relative, and absolute when
it was given absolute. Paths given on the command line print as given.

`--screens` names the screens file and is required whenever screens are
added; there is no default. It takes any `.md` file inside the root; one
outside it is an error (`the screens file <file> points outside <root>`).
A screens file whose path from the root contains `#`, `|` or `]` is
refused, since those end the path in an embed link.
Missing embed styling frontmatter is added; existing values are preserved.
Invalid screens and unknown nodes leave the drawing untouched.
A frame's image and its `F3 · Title` label share an Excalidraw group, so
they move together: clicking either selects both; double-click to select
one. Human output is one `F3  team-members  548x333` line per frame, then one
`F1 -> F2` line per arrow. The size is the embed image size in the drawing.
JSON is `{ flow, frames: [{ frame, screen, title, id, x, y, width, height }],
screensFileUpdated }`, where `id` is the image's element id; `flow new` adds
`arrows: [{ id, from, to, label, x, y, width, height }]`.
A file or input problem, such as a missing file, an unknown screen or node,
or a file that is not a drawing, exits 1 with a plain message (JSON adds an
`errors` array); usage errors exit 2. Any other error is a bug and crashes
with a stack trace.

Flow commands refuse to overwrite a drawing or screens file that changed
while the command was running, and replace files atomically. The check is
best effort: a save landing in the last instant can still be lost. If the
screens file changed, the drawing is left as it was, and `flow new` leaves no
file behind. Close the drawing in Obsidian before running flow commands, or
retry after a concurrent save.

The next commands edit an existing drawing and need no screens file. Nodes
are frames (F1, F2, ...) and decisions (D1, D2, ...); everything is placed
relative to the nodes where they are now, so moving them by hand is fine.

- `wiredown flow decision <flow.excalidraw.md> <text> [--right-of N |
--below N] [--json]` appends a decision diamond (default: right of the
  rightmost node). Prints `D1  260x170`; JSON is
  `{ flow, decision: { node, id, text, x, y, width, height } }`, where `id`
  is the diamond's element id and `text` is as written, wrapped.
- `wiredown flow connect <flow.excalidraw.md> <from> <to> [<label>] [--json]`
  appends a straight arrow between the facing edges of two nodes, bound to
  both, with an optional label. A further arrow between the same pair is
  offset beside the first. Existing arrows are not rerouted. Prints
  `F2 -> D1  "Submit"`; JSON is
  `{ flow, arrow: { id, from, to, label, x, y, width, height } }` (`label` is
  `null` when absent; `x`, `y` is the arrow's start).
- `wiredown flow note <flow.excalidraw.md> <node> <text> [--json]` appends a
  free text note under the node, below the notes still in its stack, wrapped to the
  node's width. The note joins the node's group, so it moves with the node.
  Prints `F1  note <element-id>`; JSON is
  `{ flow, note: { id, node, text, x, y, width, height } }` (`text` as
  written, wrapped).

An unknown node (the error lists the nodes that exist), a node name two
elements claim (a copy pasted before elements recorded their own id: remove
it by its element id with `flow remove`, below), or connecting a node to
itself writes nothing. A copy pasted since is left alone: commands use the
original. Operational errors exit 1 (JSON adds an `errors` array, and the
command's key is `null`); usage errors exit 2.

A new note goes under the notes still in the stack. Notes moved far away
are ignored for stacking. Notes allow 60 px horizontal nudges and gaps of
up to 200 px after the node or the previous note, leaving room for a deleted
note. Decision notes stack beside the diamond.

`wiredown flow highlight <flow> <frame> <#id> [--json]` outlines a
component with the focus colour. `wiredown flow mark <flow> <frame> <#id>
<label> [--json]` places a filled circle with bound text just outside the
component's top-left corner, up and left of it by a third of the circle's
width, so it does not cover what it marks. Quote ids in the shell, for
example `'#invite'`; bare `invite` also works. These commands read the
screen from the screens file the frame's embed names (see above), without
changing it; a frame whose embed does not resolve is an error naming the
frame. An overlay records the id of its frame's image element and joins the
frame's group, so it moves with the frame. Human output is `F2  highlight  #invite` or
`F2  mark 3  #members`. JSON shapes are:

```text
{ flow, highlight: { id, frame, screen, target, x, y, width, height } }
{ flow, mark: { id, frame, screen, target, label, textId, x, y, width, height } }
```

`target` is the component id; mark coordinates are the circle's top-left,
and `textId` is the id of the label's text element inside the circle.
Unknown frames, decisions, missing or invalid screens, unknown component ids
and duplicates exit 1 and leave the file untouched. Errors follow the other
flow commands' findings convention. A second mark with another label is
allowed. Overlays use current image position and size, including independent
axis scales after a distorted resize. Highlights extend 4px beyond the box.

Frames are sized for a screen with 10px of host padding on each side, a 5px
footer and no border: the Excalidraw plugin's default Markdown embed, with
the border off because the `excalidraw-css` front matter that `flow new` and
`flow add-screen` add to the screens file mentions `svg`. Frames keep their
size when a drawing opens unless a person's own embed CSS changes the
padding or footer. The constants live in
`packages/excalidraw/src/flow-edit.ts`; one change there corrects both embed
sizing and overlay placement.

### refresh, lint and remove

`wiredown flow refresh <flow> [--json]` brings a flow up to date after its
screens change. Each frame's screen comes from the screens file its embed names,
so one flow may use several. For each frame whose screen exists it sets the `##
Embedded Files` link size, resizes the image to the new screen size at the scale
it had (a frame a person scaled stays scaled; its top-left stays put), and moves
the frame's highlights and marks to where `flow highlight` and `flow mark` would
put them now. Whenever it rewrites a frame's link it writes the path from the
root, as new embeds are written; links it leaves alone keep their form. Notes
under the frame move with its bottom edge, keeping their order and gaps; a note
dragged onto the frame goes back under it, with the notes below it. Every
straight arrow of ours whose ends are not where `flow connect` would put them
now, because a frame was resized or a person moved a node, is re-routed that
way, keeping its place among parallel arrows, its label (placed along it as
`flow connect` places it) and its id. An arrow a person bent (more than two
points) is left alone, and reported as unresolved while an end no longer meets
its node (a frame grew under it, or moved away). Displaced labels and notes return to their places; decisions and hand-
drawn arrows stay where they are. Frames are never moved apart, so a frame that
grew may now overlap its neighbouring frame; lint reports that. An overlay whose
component is gone is left where it is and reported as unresolved. The file is
written only if something changed.

Human output is one line per change, or `up to date` when nothing changed and
every screen was found:

```text
F2  embed 548x373 -> 548x413
F2  note moved
F2  highlight #invite moved
F2  mark 3 #members unresolved: ^team-members has no #members any more
F2  arrow F2 -> F3 re-routed
F2  arrow F1 -> F2 unresolved: it was bent by hand and no longer meets F2; straighten or move it in the drawing
```

(`F2  image WxH -> WxH` when only the image's aspect was off.) JSON is
`{ flow, changes: [...], unresolved: [...] }`, with `decompressed: true`
when a compressed drawing was rewritten and an `errors` array when a screen
could not be used. A change is
`{ frame, kind: "embed", element, link: { from, to }, image: { from, to } }`
(sizes are `{ width, height }`),
`{ frame, kind: "highlight" | "mark", element, target, label?, textId? }`
(`textId` is a mark's text element), `{ frame, kind: "note" | "label", element }`,
`{ frame, kind: "group", element, part, group }` or
`{ frame, kind: "arrow", element, from, to }`, where an arrow's `frame` is
the node it stopped meeting; unresolved ones add `unresolved`, the reason.
Every change also has `x`, `y`, `width` and `height`, the element's geometry
as refresh leaves it.
An overlay belongs to the frame whose image element id it records, whatever
the frame is now called. Exit 0; 1
if a frame's embed names no screens file (reported as
`flow: F2: error: embeds [[ui#^members]], but no ui.md was found in
<root>`) or a screen a frame embeds is missing or has errors (reported as
findings in that screens file); the other frames are still refreshed. If
several files match a frame's embed, refresh reports it, naming them, and
writes nothing; so it does when two elements claim one node name (the
error `flow note` gives). Each JSON error adds the `file` it is about. A
person's copy of our elements is left where it is.

`wiredown flow lint <flow>... [--json]` never writes. It reports, as
`path: F2: error: message` and a summary line per file:

- a frame whose embed names no screens file, matches several (naming
  them), points outside the flow's root, or whose screen is missing or has
  errors;
- two frames or decisions claiming one name, a copy pasted before elements
  recorded their own id: `F2 is claimed by elements <a> and <b>; remove
the copy with "wiredown flow remove <flow> <a>" or "wiredown flow remove
<flow> <b>"` (the flow commands,
  refresh included, refuse until then);
- a person's copy of our elements, once per pasted group: `element <id> is
a copy of F2's frame; flow commands leave copies alone: delete it in the
drawing, or run "wiredown flow remove <flow> <id>"` (or of `F2's note`,
  `F2's highlight`, `arrow F1 -> F2`, …);
- a stale frame: its link size is not the screen's current size, or its
  image's aspect ratio no longer matches (more than 1%; scaling a frame
  uniformly is fine);
- a stale overlay (more than 1px from where refresh would put it), one
  whose component or frame is gone, or one drawn for another screen than
  its frame now embeds;
- a note whose frame or decision is gone: `note "<first words…>" is on a
node that no longer exists; remove it with "wiredown flow remove <flow>
<id>"`, and the same hint, with the element id, on overlays whose frame or
  component is gone and arrows of ours whose node is gone;
- a note whose top edge lies inside its frame: `note "<first words…>"
overlaps F1; run "wiredown flow refresh" or move it`;
- a dangling arrow, ours or hand-drawn: bound to an element that is missing,
  deleted, or does not list the arrow in `boundElements` (the same for bound
  text and its container), or one of ours whose node is gone;
- a straight arrow of ours whose end is more than 12px from where
  `flow connect` would put it now, or inside a frame (Excalidraw moves an end
  bound to a decision by up to 6px when it opens the drawing): `arrow F1 -> F2 no longer meets F1; run
"wiredown flow refresh"`;
- an arrow of ours a person bent whose end no longer meets its node (more
  than 12px off it, or inside a frame): `arrow F1 -> F2: it was bent by hand
and no longer meets F1; straighten or move it in the drawing` (refresh
  leaves it);
- two of our frames or decisions whose boxes overlap, once per pair on the
  later one: `F3: overlaps F1; move one of them in the drawing, or with
"wiredown flow move", e.g. "wiredown flow move <flow> F3 --below F1"`
  (touching edges are fine);
- an image whose `fileId` has no `## Embedded Files` entry;
- data written by a newer wiredown, once: `this drawing was written by a
newer wiredown (data version N)`; that data is otherwise ignored.

Style, bent arrows that meet their nodes and working hand-drawn elements are
never reported;
when lint finds nothing, refresh has nothing to do. Exit 1 if any file has
findings. JSON is `{ files: [{ file, findings }] }`, a
finding being `{ message, frame?, element? }` (`element` is the element id).

`wiredown flow remove <flow> <what>... [--json]` removes what lint reports
as stale or wrong, or what is no longer wanted, so a flow is never fixed by
hand-editing its JSON. Each `<what>` is one of:

| Target                        | Removes                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `F2`, `D1`                    | the node, its label or text, its notes and overlays, and our arrows to or from it |
| `'F1->F2'`                    | every arrow of ours from F1 to F2 (not F2 to F1), with labels                     |
| `'F2#invite'`                 | the highlight on `#invite`                                                        |
| `'F2#invite:3'`               | the mark labelled `3` on `#invite`, with its text                                 |
| `F2:note`, `F2:note:2`        | all of the node's notes, or the second from the top                               |
| an element id (`--json`/lint) | that element of ours and its bound text; for a copy, the copies pasted with it    |

Quote targets with `>` or `#` in the shell. Removing works as Excalidraw
deletes: elements are marked `isDeleted` with a version bump, their text
leaves `## Text Elements` and unused embeds leave `## Embedded Files`.
Their F- and D-numbers stay taken until the drawing is saved in Obsidian,
whose Excalidraw plugin drops deleted elements; after that, the next frame
or decision can reuse a removed number. Everything else is untouched, except that
remaining nodes drop removed arrows from `boundElements`. An arrow a person
drew bound to a removed node is kept, with that end unbound. An element
without wiredown data is refused (`element <id> has no wiredown data, so a
person drew it; …`), so the command never deletes a person's drawing.

A person's copy of our elements (a pasted frame, an Alt-dragged note) is
theirs: `flow remove F2` leaves it, and a copied arrow bound to F2 is
unbound like a hand-drawn one. Only its element id, as lint prints it,
removes it, with the copies pasted with it (its group, its bound text).
A copy pasted before elements recorded their own id instead makes `F2`
ambiguous, so `flow remove F2` refuses with lint's message naming both
elements; `flow remove <flow> <copy's image id>` removes that copy and our
elements in its group (its pasted label). If the copy has no group of its
own, its label stays and the output says so; remove the label by its id.
Overlays and notes whose node is gone are removed by the element id lint
prints.

Targets are checked first, all or nothing: an unknown one (`unknown node
"F9" (nodes: F1, F2, D1)`, `no arrow F2->F1 (arrows: F1->F2)`, `F2 has no
highlight on #x (overlays: F2#invite, F2#seats:2)`, `F2 has 1 note; …`)
exits 1 and writes nothing. Human output is one line per target, then one
per unbound arrow:

```text
removed F2 (frame, 1 note, 2 overlays, 2 arrows)
removed arrow F1 -> F2
removed highlight F2 #invite
removed mark F2 #seats 2
removed note <id> on F2
removed 2 notes on F2
removed label <id> of F2
removed <id>, a copy of F2's frame, and 1 element pasted with it
removed <id>, one of the elements claiming F2 (frame)
left the label of F2, and any notes or overlays pasted with it: the copy has no group of its own; remove them by element id
unbound a hand-drawn arrow <id> from F2
```

JSON is `{ flow, removed: [{ kind, element, elements, node?, from?, to?,
target?, label?, notes?, overlays?, arrows?, copy?, labelLeft?, of? }], unbound:
[{ element, from, x, y, width, height }] }`, where `kind` is `frame`,
`decision`, `arrow`, `highlight`, `mark`, `note`, `label` or `copy` (with
`of`, what it copies: `F2's frame`), `element` is the id of the element the
target named and `elements` every element removed, each as `{ id, type,
text?, x, y, width, height }` (`text` for text elements). Each `unbound`
entry is a person's arrow with its geometry. Errors exit 1 with `removed` and
`unbound` empty and an `errors` array.

`wiredown flow move <flow> <node> (--right-of N | --below N | --to <x>,<y>)
[--json]` moves a frame or decision when lint reports that it overlaps
another, or when the layout should change. `--right-of` and `--below` place
it where `flow add-screen` and `flow decision` would put a new node next to
`N` (placement ignores hand-drawn elements); `--to` gives its top-left in
drawing coordinates (write `--to=-200,0` for a negative x). What of ours
belongs to the node moves with it by the same distance: its label or text,
its notes, its highlights and marks, as `flow remove` would take them. Our
straight arrows bound to it are re-routed as `flow refresh` re-routes them,
labels included; one a person bent is left, and reported as `unresolved` when
it no longer meets a node, as refresh and lint report it.
A person's arrows, copies and drawing never move, even inside the node's
group.

It refuses, writing nothing, an unknown node, a name two nodes claim, a
drawing from a newer wiredown, and a place where the node would overlap
another of ours: `F3 at 760,0 would overlap F2; pick another place`.
Touching edges are not an overlap. Output is one line, then one per bent
arrow, as refresh prints it:

```text
moved F3 to 760,0 (frame, 1 note, 2 overlays, 2 arrows)
F3  arrow F2 -> F3 unresolved: it was bent by hand and no longer meets F3; straighten or move it in the drawing
```

The counts are the notes and overlays that moved and the arrows re-routed.
A node already at the place is left, and the command prints `F2 is already
at 0,0`.

JSON is `{ flow, moved: { unchanged?, node, kind, element, x, y, width,
height, elements, notes, overlays, arrows }, changes: [...], unresolved:
[...] }`: `element` is the node's element and `x, y, width, height` its new
box, `elements` every element id moved (the node's first; empty when it did
not move), `changes` the re-routed arrows and `unresolved` the bent ones,
each as `flow refresh --json` reports an arrow change (with its geometry). A
node already there has `unchanged: true`. Errors exit 1 with `moved: null`,
`changes` and `unresolved` empty and an `errors` array.

Keep flows diffable by turning off "Compress Excalidraw JSON in Markdown"
in the Excalidraw plugin's Saving settings. `flow lint` reports compressed
drawings; `flow refresh` rewrites them as JSON even when already up to date.

Lint reports labels more than 60 px from their place above the frame. Notes stay
in the stack within 60 px horizontally and with a vertical gap of at most 200 px
from the node or previous in-place note, leaving room for a deleted note. They
may overlap that edge by up to 60 px. Refresh returns displaced notes after the
retained stack in vertical order, under a frame or beside a decision. It
restores groups only on parts with no group; personal groups and small hand
nudges stay untouched. Far notes beside a decision are handled the same way. A
label or note with a group absent from its node is left untouched and does not
take a place in the note stack.

`wiredown render flows/example.excalidraw.md --out out --json` exports the
whole drawing to `out/example.svg` (`out/example.png` with `--format png`).
Each frame's screen comes from the screens file its embed names, resolved
from the flow as the flow commands do. `--screen` is only for screens files.
Missing or invalid screens, and embeds that name no screens file, are
reported as `flow lint` words them, one finding per frame or image; nothing
is drawn in their place. An image that embeds a whole file or a heading
rather than a screen block is not drawn either, and is reported. In each
case the image is still written and the command exits 1. Flow JSON is
`{ file, format, flow: { svg, width, height }, errors, warnings }`. The size is
rounded to whole pixels, as a screen's is; the SVG keeps Excalidraw's exact
size.
A file that is not an Excalidraw drawing, a drawing written by a newer
wiredown, or a screens file an embed names that cannot be read, is an error
(exit 1): nothing is written, and the JSON has `flow: null`.

Flow embeds include their own Excalifont copy, since nested SVG images cannot
use the outer SVG's fonts. Each distinct screen is rendered once. This adds
about 33 KB per screen before data URL encoding, plus the outer font copy.
A measured three-screen flow was 227,147 bytes with fonts and 60,397
without. Use `--no-fonts` for smaller files when font portability is
unnecessary.
Dark flows use light screen images with Excalidraw's own dark image filter.

Flow renders reject drawing image files unless they contain inline PNG, JPEG,
GIF, WebP or SVG data URLs; each rejection is a finding (exit 1), and the
render is still written, as with missing screens.

## API

The root export runs the commands without a terminal. Each resolves to a
`Result`, `{ exitCode, stdout, stderr }`, and never writes to the terminal
or exits; `bin/wiredown.js` prints the result. Build the package
(`pnpm build`) before running the bin.

- **CLI** (`index`): `run(argv)` runs the CLI on `argv` without node and
  the script, as `bin/wiredown.js` does. Bad usage and unreadable files
  give exit code 2, and the `flow` commands report file and input problems
  with exit code 1; any other error rejects.
- **Check** (`check`): `check(files, options?)` runs the `check` command
  on a list of paths. `CheckOptions` is `{ json? }`; `CheckedFile` is one
  entry of the JSON document's `files`.
- **Render** (`render`): `render(file, options?)` runs the `render`
  command on a screens file or a `*.excalidraw.md` flow. `RenderOptions`
  are all optional: `screens` (ids, for a screens file; all screens with an
  id when empty), `out` (default `.`), `format` (`"svg"` or `"png"`,
  default `"svg"`), `scale` (PNG pixels per SVG pixel, default 2),
  `transparent`, `theme` (`"light"` or `"dark"`), `fonts` (default true;
  SVG only) and `json`. `Output` is a written image,
  `{ svg?, png?, width, height, pixelWidth?, pixelHeight? }`, as in the
  JSON document's `flow`; `RenderedScreen` is an `Output` with `id` and
  `boxes`, one entry of its `screens`.
- **Lint** (`lint`, `flow`): `lint(paths, options?)` runs the `lint`
  command on files and directories (`.` when empty). `LintOptions` is
  `{ json?, exclude? }` (`exclude`: globs, as `--exclude`); `LintedFlow`, `{ file, findings }`, is one entry of the JSON
  document's `flows`.
- **Skill** (`skill`): `skill(dir, options?)` runs the `skill` command.
  `SkillOptions` is `{ json? }`.
- **Output** (`output`): `UsageError`, which `check`, `lint`, `render` and
  `skill` throw for an unreadable file and `run` turns into exit code 2. `Finding`
  is a finding as above; a flow's names a `frame` and an `element` instead
  of a `screen`. `Result` is what every command returns.

```ts
import { render } from "@wiredown/cli";

const { exitCode, stdout } = await render("screens.md", { out: "out", json: true });
```

# @wiredown/cli

The `wiredown` command: checks and renders the screens in a Markdown file
headlessly in Node, with JSON output for agents.

```sh
wiredown check <file.md>... [--json]
wiredown lint [<path>...] [--json]
wiredown render <file.md> [--screen <id>]... [--out <dir>] [--theme light|dark] [--no-fonts] [--json]
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

`--theme dark` lets Excalidraw draw the dark theme; file names don't change,
so pick another `--out`. `--no-fonts` leaves Excalifont out of the SVG.

## lint

`wiredown lint [<path>...] [--json]` is the check for CI. Each path is a file
or a directory, walked recursively, skipping `node_modules` and
dot-directories; with no paths it lints `.`. It runs `flow lint` on every
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
elements claim (a copy pasted before elements recorded their own id: delete
the copy), or connecting a node to itself writes nothing. A copy pasted
since is left alone: commands use the original. Operational errors exit 1
(JSON adds an `errors` array, and the command's key is `null`); usage
errors exit 2.

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

Frames are sized for the Excalidraw plugin's default Markdown embed, as
measured in Obsidian: 10px host padding on each side, a 2px border on every
side, and a 5px footer. The constants live in
`packages/excalidraw/src/flow-edit.ts`; one change there corrects both embed
sizing and overlay placement. With the plugin's border turned off, frames
are reshaped when the drawing opens and lint reports them (issue #42).

### refresh and lint

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
  recorded their own id: `F2 is claimed by elements <id> and <id>; delete
the copy` (the flow commands, refresh included, refuse until then);
- a person's copy of our elements, once per pasted group: `element <id> is
a copy of F2's frame; flow commands leave copies alone: delete it in the
drawing` (or of `F2's note`, `F2's highlight`, `arrow F1 -> F2`, …);
- a stale frame: its link size is not the screen's current size, or its
  image's aspect ratio no longer matches (more than 1%; scaling a frame
  uniformly is fine);
- a stale overlay (more than 1px from where refresh would put it), one
  whose component or frame is gone, or one drawn for another screen than
  its frame now embeds;
- a note whose frame or decision is gone: `note "<first words…>" is on a
node that no longer exists`;
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
  later one: `F3: overlaps F1; move one of them in the drawing` (touching
  edges are fine);
- an image whose `fileId` has no `## Embedded Files` entry;
- data written by a newer wiredown, once: `this drawing was written by a
newer wiredown (data version N)`; that data is otherwise ignored.

Style, bent arrows that meet their nodes and working hand-drawn elements are
never reported;
when lint finds nothing, refresh has nothing to do. Exit 1 if any file has
findings. JSON is `{ files: [{ file, findings }] }`, a
finding being `{ message, frame?, element? }` (`element` is the element id).

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
whole drawing to `out/example.svg`. Each frame's screen comes from the
screens file its embed names, resolved from the flow as the flow commands
do. `--screen` is only for screens files.
Missing or invalid screens, and embeds that name no screens file (one
finding per frame), leave placeholders; the SVG is still written, findings
are reported, and the command exits 1. Flow JSON is
`{ file, flow: { svg, width, height }, errors, warnings }`. The size is
rounded to whole pixels, as a screen's is; the SVG keeps Excalidraw's exact
size.
A file that is not an Excalidraw drawing, or a drawing written by a newer
wiredown, is an error (exit 1) and nothing is written; a screens file an
embed names that cannot be read exits 2.

Flow embeds include their own Excalifont copy, since nested SVG images cannot
use the outer SVG's fonts. Each distinct screen is rendered once. This adds
about 33 KB per screen before data URL encoding, plus the outer font copy.
A measured three-screen flow was 244,120 bytes with fonts and 77,374
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
  give exit code 2, and the `flow` commands report their own errors with
  exit code 1; any other error rejects.
- **Check** (`check`): `check(files, options?)` runs the `check` command
  on a list of paths. `CheckOptions` is `{ json? }`; `CheckedFile` is one
  entry of the JSON document's `files`.
- **Render** (`render`): `render(file, options?)` runs the `render`
  command on a screens file or a `*.excalidraw.md` flow. `RenderOptions`
  are all optional: `screens` (ids, for a screens file; all screens with an
  id when empty), `out` (default `.`), `theme` (`"light"` or `"dark"`),
  `fonts` (default true) and `json`. `RenderedScreen` is one entry of the
  JSON document's `screens`.
- **Lint** (`lint`, `flow`): `lint(paths, options?)` runs the `lint`
  command on files and directories (`.` when empty). `LintOptions` is
  `{ json? }`; `LintedFlow`, `{ file, findings }`, is one entry of the JSON
  document's `flows`.
- **Output** (`output`): `UsageError`, which `check`, `lint` and `render`
  throw for an unreadable file and `run` turns into exit code 2. `Finding`
  is a finding as above; a flow's names a `frame` and an `element` instead
  of a `screen`. `Result` is what every command returns.

```ts
import { render } from "@wiredown/cli";

const { exitCode, stdout } = await render("screens.md", { out: "out", json: true });
```

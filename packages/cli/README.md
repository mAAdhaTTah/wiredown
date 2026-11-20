# @wiredown/cli

The `wiredown` command: checks and renders the screens in a Markdown file
headlessly in Node, with JSON output for agents.

```sh
wiredown check <file.md>... [--json]
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

## flow

`wiredown flow new <flow.excalidraw.md> [<screen-id>...] [--screens <screens.md>]
[--json]` creates an empty drawing or a row of frames, each connected to the
next by an unlabelled arrow (F1 -> F2 -> F3); an existing file is an error.

`wiredown flow add-screen <flow.excalidraw.md> <screen-id> [--right-of F2 |
--below F2] [--title <text>] [--screens <screens.md>] [--json]` appends a frame
relative to the current position of a node. Default placement is right of the
rightmost node. Titles default to the screen heading, then its id.

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
JSON is `{ flow, frames: [{ frame, screen, title, x, y, width, height }],
screensFileUpdated }`; `flow new` adds `arrows: [{ id, from, to, label }]`.
Operational errors exit 1 (JSON adds an `errors` array); usage errors exit 2.

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
  `{ flow, decision: { node, x, y, width, height } }`.
- `wiredown flow connect <flow.excalidraw.md> <from> <to> [<label>] [--json]`
  appends a straight arrow between the facing edges of two nodes, bound to
  both, with an optional label. A further arrow between the same pair is
  offset beside the first. Existing arrows are not rerouted. Prints
  `F2 -> D1  "Submit"`; JSON is `{ flow, arrow: { id, from, to, label } }`
  (`label` is `null` when absent).
- `wiredown flow note <flow.excalidraw.md> <node> <text> [--json]` appends a
  free text note under the node, below the notes still in its stack, wrapped to the
  node's width. The note joins the node's group, so it moves with the node.
  Prints `F1  note <element-id>`; JSON is `{ flow, note: { id, node } }`.

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
  command. `RenderOptions` are all optional: `screens` (ids; all screens
  with an id when empty), `out` (default `.`), `theme` (`"light"` or
  `"dark"`), `fonts` (default true) and `json`. `RenderedScreen` is one
  entry of the JSON document's `screens`.
- **Output** (`output`): `UsageError`, which `check` and `render` throw
  for an unreadable file and `run` turns into exit code 2. `Finding` is a
  finding as above; `Result` is what every command returns.

```ts
import { render } from "@wiredown/cli";

const { exitCode, stdout } = await render("screens.md", { out: "out", json: true });
```

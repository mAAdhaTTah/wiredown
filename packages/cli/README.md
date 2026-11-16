# @wiredown/cli

The `wiredown` command: checks and renders the screens in a Markdown file
headlessly in Node, with JSON output for agents.

```sh
wiredown check <file.md>... [--json]
wiredown render <file.md> [--screen <id>]... [--out <dir>] [--theme light|dark] [--no-fonts] [--json]
wiredown --help | <command> --help | --version
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

## API

`run(argv)` and the commands `check(files, options)` and
`render(file, options)` return `{ exitCode, stdout, stderr }` without
writing to the terminal or exiting; the `bin/wiredown.js` entry prints the
result. Build the package (`pnpm build`) before running the bin.

## flow

`wiredown flow new <flow.excalidraw.md> [<screen-id>...] [--screens <screens.md>]
[--json]` creates an empty drawing or a row of frames; an existing file is
an error.

`wiredown flow add-screen <flow.excalidraw.md> <screen-id> [--right-of F2 |
--below F2] [--title <text>] [--screens <screens.md>] [--json]` appends a frame
relative to the current image position. Default placement is right of the
rightmost frame. Titles default to the screen heading, then its id.

Screens are discovered in the parent of the flow directory, then the flow
directory itself. Missing embed styling frontmatter is added; existing values
are preserved. Invalid screens and unknown frames leave the drawing untouched.
Human output is one `F3  team-members  548x333` line per frame. The size is
the embed image size in the drawing. JSON is
`{ flow, frames: [{ frame, screen, title, x, y, width, height }],
screensFileUpdated }`. Operational errors exit 1 (JSON adds an `errors`
array); usage errors exit 2.

Flow commands refuse to overwrite a drawing or screens file that changed
while the command was running, and replace files atomically. The check is
best effort: a save landing in the last instant can still be lost. Close the
drawing in Obsidian before running flow commands, or retry after a concurrent
save.

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

Exit codes: 0 success; 1 the file has errors, or a screen could not be
written; 2 bad usage or an unreadable file, with a message on stderr and
nothing on stdout, even with `--json`. Any other error is a bug: Node
prints its stack trace and exits 1.

A finding is `{ line?, message, screen? }`: the 1-based line in the file,
when it has one, and the `^id` of the screen it belongs to, when known.
Printed, it reads `path:line: ^id: error: message` (or `warning:`); without
a line it reads `path: ^id: error: message`.

## check

Checks every `wiredown` block in each file, resolving variants. Prints one
line per finding and a summary line per file. Exits 1 if any file has
errors; warnings don't fail.

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
unknown `--screen` id is an error that lists the ids in the file.

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
error for an unknown `--screen` id has no `line`.

`--theme dark` lets Excalidraw draw the dark theme; file names don't change,
so pick another `--out`. `--no-fonts` leaves Excalifont out of the SVG.

## API

The root export runs the commands without a terminal. Each resolves to a
`Result`, `{ exitCode, stdout, stderr }`, and never writes to the terminal
or exits; `bin/wiredown.js` prints the result. Build the package
(`pnpm build`) before running the bin.

- **CLI** (`index`): `run(argv)` runs the CLI on `argv` without node and
  the script, as `bin/wiredown.js` does. Bad usage and unreadable files
  give exit code 2; any other error rejects.
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

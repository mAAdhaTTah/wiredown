---
name: wiredown
description: Use the wiredown CLI to write or revise wireframes/screens for a PRD or spec in screens.md and user-flow drawings in .excalidraw.md files.
---

# Wiredown

Wiredown draws low-fidelity screens from text and connects them in editable
flow drawings. Use it to illustrate a PRD or spec while keeping screen states
in one place.

Keep `screens.md` and `flows/<name>.excalidraw.md` next to the PRD or spec
they illustrate. You need a shell and the `wiredown` CLI on PATH.

## Workflow

1. Write or modify `screens.md`: one heading per screen, a `wiredown` fenced
   block, its `^block-id` line after exactly one blank line, then prose notes
   about the screen. The id also works directly after the closing fence;
   more blank lines or intervening prose lose it ("screen has no ^id").
   Read [syntax](reference/syntax.md) for components and options and
   [examples](reference/examples.md) for complete screens and flow commands.
   Omit frontmatter on new files; flow commands add embed styling.
2. Check and fix every error and warning until clean:

   ```sh
   wiredown check screens.md --json
   ```

3. Render and LOOK at the PNGs. Check the layout visually: labels, wrapping,
   proportions, missing content and overlaps. Do not trust a clean check
   alone. Revise, check and render again as needed.

   ```sh
   wiredown render screens.md --format png --out out
   ```

4. Build the flow with targeted commands. This sequence uses the screens in
   the examples reference; use returned frame and decision ids in later
   commands. Quote component ids so the shell does not treat them as comments.
   The first flow command that needs it adds embed-styling frontmatter to
   `screens.md` (`screensFileUpdated: true`), shifting its line numbers: re-run
   `check` and commit the changed `screens.md` with the flow.

   ```sh
   wiredown flow new flows/members.excalidraw.md team-members --json
   wiredown flow decision flows/members.excalidraw.md 'Remove Erik?' --right-of F1 --json
   wiredown flow add-screen flows/members.excalidraw.md team-members-after-remove --right-of D1 --json
   wiredown flow connect flows/members.excalidraw.md F1 D1 'Remove' --json
   wiredown flow connect flows/members.excalidraw.md D1 F2 'Yes' --json
   wiredown flow note flows/members.excalidraw.md D1 'Confirm before removal' --json
   wiredown flow highlight flows/members.excalidraw.md F1 '#members' --json
   wiredown flow mark flows/members.excalidraw.md F2 '#notice' '1' --json
   ```

5. Render the flow and look at its PNG. Check step order, labels and notes.

   ```sh
   wiredown render flows/members.excalidraw.md --format png --out out
   ```

6. After changing a screen, refresh its flows, then lint them. Refresh
   resizes frames and moves their arrows, notes and overlays along, but it
   never moves frames apart, so a grown frame can overlap its neighbour;
   render and look again. Tell the person about anything `unresolved`, such
   as an arrow they bent by hand.

   ```sh
   wiredown flow refresh flows/members.excalidraw.md --json
   wiredown flow lint flows/members.excalidraw.md --json
   ```

7. Before committing, lint the spec directory (the default is the current
   directory):

   ```sh
   wiredown lint --json
   ```

## Authoring rules

Write ids as `#id`; give one to every component a flow or variant will point
at. Use stable screen block ids. Variants start with `extends:` and describe
changes with `replace:`, `remove:`, `after:`, `before:` or `rows:`. Never
implicitly redeclare a component to replace it. A replacement inherits its
id. This variant uses the base in the examples reference:

```wiredown
extends: team-members
replace: seats
  text: 2 of 5 seats used
replace: notice
  alert: {check} Erik Lund was removed from the team. [Undo]
rows: members
  [ ] | Maja Berg | = | = | Active
  remove Erik Lund
after: members
  text: -Removed members keep access until the end of the day-
```

^team-members-after-remove

In row patches, `=` preserves a cell; keep the row key unchanged. Grids fill
their container by default; use `(fit)` for content sizing.

Highlight interactions in the FLOW with `flow highlight` and `flow mark`,
not with `(focus)` in the screen. Notes about the screen itself go as prose
under its block; notes about a step go on the flow with `flow note`.

Use `\(` for literal option-like parentheses and `\#` for literal trailing
id-like text. Heed check's warnings about characters missing from Excalifont;
use supported text or icons instead of glyphs that may render as empty boxes.

Never hand-compute coordinates. Use `--right-of` and `--below` relative to
existing nodes. A flow is a drawing a person also edits: never regenerate an
existing flow. Use the commands, which preserve their edits. A frame's parts
(image, label, notes, overlays) are grouped and move together; a pasted copy
of a frame claims its F-number, so commands refuse that name and `flow lint`
reports it until the copy is deleted.

Each frame's embed names its screens file (`[[screens#^id]]`, or a path from
the Obsidian vault root); flow commands, render and lint follow it, so
`--screens` exists only on `flow new` and `flow add-screen`.

Turn off "Compress Excalidraw JSON in Markdown" in the Excalidraw plugin's
Saving settings; `flow lint` reports compressed drawings and tells you to run
a flow command such as `flow refresh` to rewrite them as diffable JSON.
Hand-written text elements need 8-character ids, which elements made in
Obsidian always have.
Close the drawing in Obsidian before running flow commands; commands refuse
to overwrite files changed while they run, so retry after a concurrent save.

## Diagnostics and JSON

Findings read `path:line: ^id: error: message` (or `warning:`). Lines are
1-based file lines; follow did-you-mean suggestions and recheck. Check and
lint warnings do not fail the command, so inspect the warnings array too.
Exit codes are 0 for success, 1 for content or operational failures, and 2
for usage or unreadable-file errors; exit 2 may print stderr even with JSON.

`check --json` returns `files`, each with `screens`, `errors` and `warnings`.
`wiredown lint --json` returns `{ screens: [...check per-file objects], flows: [{ file, findings }] }`.
`flow lint --json` returns `{ files: [{ file, findings }] }`.
`flow refresh --json` returns `changes` and `unresolved` arrays.
`render --json` returns `screens` with `id`, output path (`png` or `svg`),
`width`, `height` and `boxes` keyed by component id. Each box is
`{ x, y, w, h }` in image coordinates; use ids for overlays, not these numbers.
PNG output also has `pixelWidth` and `pixelHeight`. Flow rendering returns
`flow` instead of `screens`.

Flow commands with `--json` return `frames[].frame` such as `F1`, or
`decision.node` such as `D1`; reuse these ids, rather than guessing them.
`flow new` connects supplied screens in a row automatically. See the
[examples](reference/examples.md) for trimmed command results and the
[syntax reference](reference/syntax.md) for all components and variant verbs.

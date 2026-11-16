# Wiredown screen syntax: proposed changes to the Sketchdown fork

Status: draft, 2026-11-16. Baseline is the prototype fork in
`prototypes/sketchdown-fork/`, which already extends upstream Sketchdown
1.0.1. Prior art compared: Sketchdown, tsquare, Wireloom.

## Principles

1. **Additive.** Every upstream Sketchdown spec stays valid. Upstream's docs,
   cheat sheet and agent skill keep applying, and a later rewrite or upstream
   contribution can keep the same syntax.
2. **Upstream rendering is not a goal.** The fork originally chose
   `(id=name)` so base screens would still draw in the upstream plugin. With
   D1 and D2 decided, Wiredown specs show `#name` and `(focus)` as literal
   text in upstream Sketchdown. The syntax stays a superset (every upstream
   spec is valid here), but not the other way round.
3. **Variants read as a diff.** A variant block shows a reviewer what changed
   between two states of a screen, without opening the base.
4. **Notes live in the flow drawing; screens only carry anchors.** See
   "Annotations".
5. **Errors never pass silently.** Every mistake gets a line number and,
   where possible, a "did you mean".

## What stays as it is

- One component per line, `keyword: content (options)`, indentation nests.
- Grid rows as plain lines split on `|`; `[x]`/`[ ]` checkbox cells.
- `{icon}`, `[link]`, `-grey text-`, `*` for primary/selected/active.
- Trailing brackets are options only if every word in them is a known
  option; otherwise they stay text. `Save (draft)`, `Due date (optional)`
  and `3 item(s) selected` all render as text.
- Fork additions already built and tested (968 upstream + 56 new tests pass):
  `extends:`, `remove:`, `after:`/`before:`, `rows:` with `=` for an
  unchanged cell and `remove <key>`, `(id=…)`, `//` comments, wrapping grid
  cells, `(hi)` highlight.

## Running example

A base screen, used by the examples below:

```wiredown
window: Team settings
  row:
    h2: Members
    text: 3 of 5 seats used #seats
    button: *Invite member #invite
  alert: {info} Invitations expire after 7 days. #notice
  grid #members
  [ ] | Name | Email | Role | Status
  [ ] | Anna Svensson | anna@example.com | Admin | Active
  [ ] | Erik Lund | erik@example.com | Member | Active
  [ ] | Maja Berg | maja@example.com | Member | Invited
```
^team-members

## Proposed changes

### P1. Grids fill their container by default (decided, D3)

Today a grid is sized to its content; `grid (fill)` stretches it.
Content-sized tables look unfinished next to full-width ones, and authors
would have to remember `(fill)` on every table.

- Change: a grid directly inside a window, browser, box, form or section
  fills its width. `grid (fit)` keeps content sizing.
- Upstream compatibility: upstream still draws content-sized. Cosmetic only.
- Cost: small (one default in the grid layout, one new flag).

### P2. Variants say what they do: explicit `replace:`

Today a component line in a variant whose `(id=…)` matches the base replaces
that component. A reviewer can't tell a replacement from an addition without
opening the base. Make every change a verb, all in the same shape
(`verb: id`, then an indented body), and make implicit redeclaration an error.

The state after Maja accepts her invitation and Erik is removed, before (the
fork today):

```wiredown
extends: team-members
text: 2 of 5 seats used (id=seats)
alert: {check} Erik Lund was removed from the team. [Undo] (id=notice)
rows: members
  [ ] | Maja Berg | = | = | Active
  remove Erik Lund
after: members
  text: -Removed members keep access until the end of the day-
```

After:

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

- The replacement keeps the replaced component's id unless it declares one,
  so later variants can still target it.
- A top-level component line in a variant without a verb is an error:
  `line 2: "text:" in a variant needs a command: "replace: seats",
  "after: <id>" or "before: <id>"`.
- Cost: small on top of the existing 254-line variant code.

### P3. Rename the highlight: `(hi)` → `(focus)` (decided, D2)

`(hi)` is cryptic to a human reader. `(focus)` says "this is the element the
user acts on", distinct from `*` (primary/selected). Upstream draws it as
literal text; accepted under principle 2.

In flows, interactions are highlighted on the drawing
(`flow highlight F2 #invite`), not in the screen, so a screen stays reusable
across flows. `(focus)` stays in the syntax for screens viewed on their own;
the agent skill steers flows to overlays.

### P4. ~~Numbered markers: `(mark=N)`~~ (dropped)

Replaced by flow overlays: `flow mark F2 #members 3` draws a numbered badge
on the drawing, positioned over the screen element with that `#id` (see the
design doc, "Interactions belong to flows"). Which element a note points at
belongs to the flow, not the screen. This makes `#id` (P7) the anchor that
matters.

### P5. Validate options per component

The fork already reports unknown options and bad references
(`unknown option "disbled"; did you mean "disabled"?`; variant references
list the ids that exist). The remaining gap: options are checked against the
global list, not per component, so `button: Save (striped)` is accepted and
ignored.

- Change: a catalog of allowed options per component, used by `check`, the
  parser and the agent skill's syntax reference (generated from one source).
  Error shape: `line 3: button doesn't take "striped" (it takes: w, h, fill,
  disabled, round, focus)`.
- Also carry icon-name warnings (`{warnin}`) into `check`.

### P6. Escape for text that ends in an option word

`text: Column width (fill)` loses `(fill)` because every word in the brackets
is a known flag. Rare, but silent. Allow `\(` to keep brackets as text, and
have `check` warn when a text-bearing component's trailing brackets are all
flags it doesn't take (P5 makes this detectable).

### P7. `#id` shorthand (decided, D1)

`button: Invite member #invite` is the same as
`button: Invite member (id=invite)`. Both forms stay valid; the agent skill
writes `#id`.

- Parsing rule: an id is a trailing token `#[a-z][a-z0-9-]*`, after the
  content and before any options (`button: Invite #invite (focus)`). Anything
  else stays text, so a grid header `# | Name | …`, `Step #3` and `C#` are
  unaffected.
- Grid rows don't take ids; `rows:` keys rows by their first text cell.
- Same collision class as P6: text that ends in `#word` (`Tag #urgent`)
  would become an id. `\#` keeps it as text. Duplicate ids on one screen are
  an error.
- Variant verbs take the bare id: `replace: notice`, `remove: invite`.

## Annotations

Notes go in the flow drawing: that's where context lives, and Excalidraw
text, arrows and sticky notes are the natural tools. Two gaps that pure
drawing notes leave, and how they're covered:

1. **Anchoring inside a screen.** A screen in a flow is an image embed. A
   drawing arrow can't target "the third row of F2" reliably, and when the
   screen re-lays out after an edit the arrow points at the wrong thing.
   Flow overlays (`flow mark`, `flow highlight`) anchor to the component's
   `#id` and move with it on `flow refresh`; the drawing's note refers to
   the number.
2. **Notes about a screen, not a flow.** A gap that belongs to the screen
   itself ("unspecified: what an expired invitation shows") should travel
   with the screen to every flow that embeds it. No syntax needed:
   `screens.md` is Markdown, so it's prose under the block, and it renders in
   Obsidian and on the forge.

## Considered and not proposed

- **Inline state guards (`?removed …`) and parameterised includes
  (`define`/`use`/`$x`).** Compared with `extends`: guards bloat the base
  and a misspelt state silently draws nothing; includes need string options
  in every component and still copy table rows.
- **Quoted text and `key=value` everywhere (as in tsquare and Wireloom).**
  Removes ambiguity, but costs readability and breaks principle 1.
  Trailing-bracket parsing plus P5/P6 covers the ambiguity.
- **Whole tables on one line (`data=[[…]]`) or quoted `tr "a|b|c"` rows.**
  Both read worse than plain lines.
- **Annotation text and leader lines in the screen syntax.** See
  "Annotations".

## Decisions (2026-11-15)

- **D1. Ids:** `#x` as well as `(id=x)`; the skill writes `#x` (P7).
- **D2. Highlight:** `(focus)` (P3).
- **D3. Grids:** fill their container by default (P1).

## How to test it

Measure with the model expected to author screens, comparing the fork as it
is today with the fork after these changes.

- **Material:** a real product's PRD with several screens and flows, written
  from its prose and rough wireframes, not from existing specs.
- **Tasks, a few runs each per syntax:**
  1. Write N screens from the PRD prose.
  2. Write a variant from a one-line change description.
  3. Apply a reviewer comment ("show the invited state on row 3; mark the
     Role column as unclear").
- **Measures:** `check` errors on the first attempt, fix rounds to a clean
  `check`, lines, and diff size for task 3. A reviewer rates readability of
  the task-2 and task-3 diffs blind (which syntax is which hidden).
- **Prerequisite:** P2, P3, P5 and P7 implemented in the fork, since the test
  needs the real parser. P1 and P6 don't affect authoring errors and can
  wait.

## Naming (2026-11-16)

The project is **Wiredown**. The language, the code-block fence and the CLI
are all `wiredown`. Packages: `@wiredown/core`, `@wiredown/excalidraw`,
`@wiredown/cli`; Obsidian plugin "Wiredown", id `wiredown`. The prototypes
use the fences `wireframe` and `wireframe-x`; those are prototype names
only.

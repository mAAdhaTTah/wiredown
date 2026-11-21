<!--
Trimmed copy of docs/SYNTAX.md from the Sketchdown fork prototype
(upstream Sketchdown 1.0.1 plus the fork's additions), used as the syntax
reference for the eval's "old" arm. Obsidian-only sections (notes, pasting,
settings), milestone markers and pixel sizes were removed and the fence was
renamed to `wiredown`; the appendix on the fork additions was written for
this eval and checked against the baseline parser (tests/references.test.ts).

MIT License. Copyright (c) 2026 Magnus Haggren. Permission is hereby granted,
free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of
the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
-->

# Syntax

## Structure

- One component per line: `keyword: content (options)`.
- `grid`, `tabs`, `box`, `form`, `section`, `row`, `columns` and the frames
  (`window`, `dialog`, `browser`, `phone`) may also appear without a colon.
- Indentation nests components. Anything indented deeper than a container
  line (`tabs`, `box`, `form`, `section`, `row`, `columns` and the frames)
  goes inside it. Tabs count as 4 spaces.
- Lines that don't start with a keyword are **continuation lines** of the
  most recent component, for example grid rows, extra tab names or more
  checkbox items. A blank line ends the continuation.
- `box`, `form`, `section`, `row`, `columns` and the frames take no
  continuation lines, so such a line right after one of them is an error, as
  is a keyword without its colon (`nav (dark)` needs to be `nav: (dark)`).
  `tabs` takes them as extra tab names.
- Indenting a component under a non-container is an error. Errors list the
  line number and the rest of the spec is still drawn.
- Top-level components stack vertically.
- Options at the end of a line, in brackets: `(w=500, h=220)`. Numeric
  `k=v` pairs: `w` sets a minimum width, `h` a minimum height. Use them to
  keep a component wide when its content shrinks.
- Flags may stand alone in the same brackets: `(fill, disabled)`. Known
  flags: `fill`, `disabled`, `dark`, `round`, `segmented`, `underline`,
  `plain`, `striped`, `floating`, `required`, `invalid`, `collapsible`,
  `collapsed`, `top`, `empty`, `stacked`, `hi`. Brackets that hold an
  unknown word and no `k=v` pair are part of the text, so
  `box: Title (optional)` keeps its title. Flags and pairs mix:
  `(w=200, fill)`. What each flag does is listed under the components that
  use it.
- Bare keywords take options too: `grid (plain)`, `box (w=50)`.
- `*` marks the selected or active item: tab, dropdown value, grid row, or
  primary button.
- Lists split on `|`, and on `,` if no `|` is present. Exception: checkbox
  items split on `|` only.

## Components

| Keyword (aliases) | Example | Notes |
|---|---|---|
| `button` (btn) | `button: *Save` | `*` = primary (blue) |
| `dropdown` (select, combo, combobox) | `dropdown: *Sweden \| Norway` | shows the starred or first value; width fits the longest option |
| `checkbox` (check, checkboxes) | `checkbox: [x] Email \| [ ] SMS` | stacked vertically |
| `text` (label) | `text: Role` | continuation lines become more lines of text |
| `grid` (table, datagrid) | `grid`, then rows like `Anna, Developer` | first row is the header |
| `tabs` (tab) | `tabs: A \| *B \| C` | container; `(segmented)` and `(underline)` styles below |
| `box` (panel, group) | `box: New user` | container with an optional title bar; `(collapsible)`, `(collapsed)` and `(plain)` in Groups below |
| `section` | `section: {users} Ownership (count=3)` | container: a header line with a count and a chevron, children below |
| `form` | `form: New user (label=140)` | container like `box` whose fields' labels line up; see Forms below |
| `field` | `field: Customer \| search: Search...` | a label before one component; see Forms below |
| `row` | `row:` | container, children side by side, centred vertically |
| `icon` | `icon: search` | one icon; `(w=32)` sets its size; unknown names are an error |
| `input` (field, textbox) | `input: Anna` | one-line field; `{icon}` allowed |
| `search` | `search: Find users` | input with a search icon; says "Search" when empty |
| `password` | `password: secret` | input showing one dot per character |
| `spin` (number, stepper) | `spin: 12` | number field with up and down arrows |
| `textarea` | `textarea: Notes` | multi-line field; continuation lines are more text |
| `h1` (heading) | `h1: Users` | large text; there is no bold |
| `h2` (subheading) | `h2: Details` | smaller heading |
| `columns` (cols) | `columns: (w=1200, h=700)` | container; panels side by side, touching, all full height; `(gap=12)` adds space |
| `nav` (navigation) | `nav: {home} Home \| *{users} Users \| - \| Log out` | vertical list; `*` marks the active item, `-` a divider; items split on `\|` only; `(dark)` adds a dark background |
| `avatar` | `avatar: AS` | circle with initials (a user icon when empty); `(w=48)` sets its size |
| `details` (properties) | `details: {phone} Phone \| 070-123` | one row per line, `label \| value`; `(stacked)` puts each label, small and grey, above its value |
| `window` | `window: Settings` | container; see Frames below |
| `dialog` (modal) | `dialog: Delete user?` | container; see Frames below |
| `browser` | `browser: My app \| example.com` | container; see Frames below |
| `phone` | `phone: Users` | container; see Frames below |
| `buttons` | `buttons: Cancel \| *OK` | buttons side by side on the right of the parent's width |
| `link` | `link: Forgot password?` | blue, underlined text; icons allowed |
| `paragraph` (p, lorem) | `paragraph: lorem (lines=4)` | wrapped text; `lorem` or no text gives placeholder text; continuation lines join the text |
| `radio` (radios, option) | `radio: Small \| *Medium \| Large` | stacked like checkboxes; `*` marks the chosen one, or write `(o)` and `( )` |
| `toggle` (switch) | `toggle: [on] Wi-Fi \| [off] Bluetooth` | stacked switches; `[on]` or `*` is on |
| `slider` (range) | `slider: 40%` | track with a knob at the value |
| `alert` (message, notice) | `alert: {info} Saved! [Undo]` | tinted box around the text; continuation lines are more lines; icons and links allowed |
| `progress` | `progress: Uploading 60%` | bar filled to the percentage; other text goes above the bar |
| `tooltip` (hint) | `tooltip: Copied!` | small dark box with light text and a pointer below |
| `image` (img, picture) | `image: 320x180 Team photo` | crossed placeholder; other text is a grey caption |
| `breadcrumb` (breadcrumbs, crumbs) | `breadcrumb: Home > Users > Anna` | links with chevrons between; the `*` item, or else the last, is current |
| `pagination` (pager, pages) | `pagination: < 1 *2 3 … 10 >` | items split on spaces; a box per page, `*` filled |
| `menu` (contextmenu) | `menu: Copy \| Ctrl+C` | see Menus and trees below |
| `tree` | `tree: Project` | see Menus and trees below |
| `placeholder` | `placeholder: 240x40 Date picker` | dashed box for a component the syntax can't draw |

### Grid

```text
grid
Name, Role, Salary, Active
Anna, Developer, 52 000 kr, [x]
*Erik, PM, 61 500 kr, [ ] Admin
```

- Cells split on `,`, or on `|` if any row contains `|`.
- Markdown tables work: outer pipes are stripped and `|---|` lines ignored.
- `[x]` and `[ ]` draw a checkbox, optionally followed by a label.
- Numeric-looking cells are right-aligned, except in the header.
- A leading `*` selects a row (light blue fill).
- A grid is as wide as its content; `(fill)` stretches it.
- `grid (plain)` drops the outer frame, the column lines and the header
  fill. `grid (striped)` fills every other body row. They combine.
- Text cells may hold icons: `Anna, {dot} Active`.

### Tab styles

- `tabs: ACTIVE | *INACTIVE | ALL (segmented)`: one bordered strip split
  into parts, the active part filled.
- `tabs: *CONTENT | FILES (underline)`: labels on a thin line, the active
  one underlined.
- Neither style has a panel frame. Children, if any, are stacked below.

## Forms

- `field: Label | component` puts a label before one component, for
  example `field: Customer | search: Search...` or
  `field: Role | dropdown: *Developer | Project manager`. The label ends at
  the first `|` that is followed by a keyword and a colon. Without such a
  `|`, `field:` is an alias of `input`. An empty field is
  `field: Name | input:`.
- Options at the end of the line belong to the component. `(fill)` and
  `(disabled)` also apply to the label.
- `(floating)` draws the label small and grey on the component's top
  border: `field: Type | dropdown: Virtual Server (floating)`.
- `(required)` on a field's component puts a red `*` after the label:
  `field: Name | input: (required)`.
- `(invalid)` on any component draws a red outline and a red mark after
  it: `field: E-mail | input: anna@ (invalid)`.
- `form` is a `box` whose fields line up: their labels share one column, as
  wide as the longest label or `(label=140)`.

  ```text
  form: New user (w=420)
    field: Name | input: Anna Svensson (fill)
    field: Role | dropdown: *Developer | Project manager (fill)
    row: (fill)
      field: Start | input: {calendar} 2026-11-01 (fill)
      field: Team | input: Platform (fill)
  ```

- An `{icon}` at the very end of an `input`, `search` or `dropdown` is a
  button at the field's right edge: `input: 2026-10-14 {calendar}`.
- `(empty)` on `input`, `search`, `password`, `dropdown` or `spin` draws
  the field without text.
- `details (stacked)` puts each label small and grey above its value.

## Groups

- `box: Domain (collapsible)` puts a chevron at the right end of the title
  bar. `(collapsed)` draws only the title bar and leaves the children out.
  Both work on `form`.
- `section: {users} Ownership (count=3)` is a header line over a group,
  with no frame; `(collapsed)` hides its children.
- `box (plain)` stacks its children with no frame, padding or title bar.
- `row (top)` aligns its children at the top instead of the middle.

  ```text
  row (top)
    box (plain, w=320)
      form: Domain (collapsible, fill)
        field: Customer | search: Search... (fill)
      box: Journal (collapsed, fill)
    box (plain, w=320)
      section: Identity (count=2, fill)
        details: ID | S55830
        Site | Stockholm
  ```

## Frames

Frames are containers like `box`: children stack inside, and `(w=...)`,
`(h=...)`, `(fill)` and `(disabled)` work the same way.

- `window: Settings`: a title bar with window controls.
- `dialog: Delete user?` (alias `modal`): a title bar with a close control,
  and a shadow.
- `browser: My app | example.com/users`: a tab with the title, then an
  address field. Without a title, `browser: | url`, there is no tab.
- `phone: Users`: a rounded phone with a status bar; the text, if any, is
  the title of an app bar.
- `buttons: Cancel | *Delete` puts buttons on the right, as in a dialog
  footer:

  ```text
  dialog: Delete user?
    text: Anna Svensson will lose access.
    buttons: Cancel | *Delete
  ```

## Inline formatting

Inside any label (`text`, `button`, headings, `nav`, tabs, `details`, grid
cells and the like):

- `[text]` is a link: `text: Forgot [password]?`. Checkbox and toggle marks
  (`[x]`, `[ ]`, `[on]`, `[off]`) are not links.
- `-text-` is grey: `text: -Archived- users`. The dashes need a space, the
  line's start or end, or punctuation after them, so `2021-03-01` stays as
  written.
- There is no italic or bold.

## Menus and trees

A menu has one item per line: the text after `menu:`, then continuation
lines.

```text
menu: Cut | Ctrl+X
*Copy | Ctrl+C
-Paste- | Ctrl+V
-
[x] Show ruler
Zoom >
```

- `label | shortcut`: the shortcut is grey and right-aligned.
- `*` highlights an item, `-` on its own line is a divider.
- A trailing `>` draws a submenu arrow.

A tree takes its levels from the indentation of its lines. The text after
`tree:` is the root.

```text
tree: {folder} Project
  - {folder} src
    *{file} index.ts
  + {folder} docs
```

- `+ name` is a closed folder, `- name` an open one; `*` selects a row.

## Icons

- `{name}` inside a label draws an icon there: `button: {plus} Add`. Not in
  `checkbox`, `dropdown`, `password`, `textarea`, `paragraph`,
  `pagination` or frame titles. Unknown names stay as literal text.
- A button with only icons is square: `button: {filter}`. With `(round)`
  it is a circle.
- Names: search, filter, more, close, back, menu, home, user, users,
  settings, plus, edit, trash, bell, calendar, file, folder, star, info,
  check, chevron-down, chevron-right, chevron-left, chevron-up, mail, phone,
  lock, dot, key, warning, refresh, print, database, clock, code, ban,
  cloud, map, hash, network, grid.

## Modifiers

- `(fill)` stretches a component to the room its parent has: in a stack
  as wide as the inside of the box; in a `row` or `columns` with a known
  width, fill children share the width the others leave over. Stretched
  text pushes what follows to the right:

  ```text
  box: (w=420)
    row: (fill)
      text: Users (fill)
      button: Close
  ```

- `(disabled)` draws the component's lines and text grey, including
  everything inside a container.
- `(dark)` on a `box` or `nav` fills it with the dark colour:

  ```text
  columns: (w=1200, h=700)
    box (dark, w=220)
      text: {home} Home
      button: {plus} New (fill)
    box (fill)
      h1: Users
    box: Details (w=320)
  ```

## Fork additions

### Ids, comments and highlights

- `(id=name)` in a component's options names it, so a variant can change
  it: `button: *Invite (id=invite)`. Ids mix with other options:
  `(id=invite, w=120)`. An id used twice in one screen is an error.
- A line starting with `//` is a comment and is not drawn.
- `(hi)` draws an orange highlight outline around a component, for the
  element the user acts on: `button: Cancel (hi)`. It is separate from `*`.
  A grid row starting with `>` is highlighted; `>*` is highlighted and
  selected.
- Grid cells, alerts and text wrap when the frame has a width.

### Variants

A variant draws another screen with a few changes. Its first line is
`extends: <screen id>`; the lines after it say what changes:

- A component line whose `(id=...)` matches a component in the base
  replaces that component in place. A container line written without
  children keeps the base's children, so only its title or options change.
- `remove: id` removes a component; `remove: a, b` removes several.
- `after: id` and `before: id` insert the components indented under them
  after or before the component with that id.
- `rows: grid-id` changes rows of a grid, one indented row per line. A row
  is found by its key, its first cell that is not a checkbox. `=` keeps the
  base's cell; `remove <key>` removes a row; a row with a new key is added
  at the end.
- Any other component line in a variant is an error: it needs an id to
  replace, or a place under `after:` or `before:`. Errors for unknown ids
  list the ids the base has.

A base screen and a variant of it:

```wiredown
window: Members
  text: Original (id=title)
  text: Temporary (id=temporary)
  grid (id=people)
  Name | Status
  Anna | Invited
  Erik | Active
```

^base

```wiredown
extends: base
text: Updated (id=title)
remove: temporary
before: people
  text: Before table
after: people
  text: After table
rows: people
  Anna | Active
  remove Erik
```

^updated

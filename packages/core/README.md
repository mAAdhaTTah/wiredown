# @wiredown/core

Wiredown's parser, variant resolution, layout and text metrics. It has no DOM
and no Excalidraw dependency: layout turns a text spec into positioned draw
operations, and text measuring is injected by the host.

## Use

The package is private to this workspace. Depend on it with
`"@wiredown/core": "workspace:*"` and import from the package root; it has
no other entry points. Build it first (`pnpm build`): outside the
workspace's type-checking, imports resolve to `dist/`.

```ts
import { formatError, layout, resolve, tableMeasure } from "@wiredown/core";

const spec = ["row:", "  button: Cancel", "  button: *Save"].join("\n");

const { tree, errors } = resolve(spec);
for (const error of errors) console.warn(formatError(error));

const { ops, size } = layout(
  tree,
  { x: 0, y: 0 },
  {
    measure: tableMeasure,
    style: { fontSize: 16, fontFamily: 1 },
  },
);
// ops: rect, line, text and ellipse operations in drawing order;
// size: the width and height they cover.
```

Errors do not stop parsing: `resolve` and `parse` always return a tree, and
a line they cannot read is reported in `errors` and left out of it.

## API

The root export is the whole public API.

- **Fenced blocks** (`detect`): `FENCE_KEYWORD` (`wiredown`), the info
  string of a fenced code block that holds a spec.
- **Parsing** (`parse`): `parse(source)` returns `{ tree, errors }`, a
  `SpecNode` tree and `ParseError`s with 1-based lines. `formatError(error)`
  gives `line 3: …`. `parseOptions(text, takes)` reads a trailing `#id`
  and `(k=v, flag)` group, offering the options in `takes` first for "did
  you mean"; `nearest(word, known)` is the "did you mean" lookup.
- **Catalog** (`catalog`): `CATALOG`, a `CatalogEntry` for every component
  and variant directive: its node type, keywords, description, a minimal
  `example`, and the flags and number options it takes. `COMMON_FLAGS` are
  the flags every component takes; `catalogEntry(type)` finds a type's entry
  and `optionsOf(entry)` lists every option it takes.
- **Checking** (`check`): `check(source, options)` resolves a block as
  `resolve` does and returns a `CheckResult`: the tree, the errors and
  `warnings` about what draws but is probably a mistake (a misspelt icon,
  characters the font lacks, brackets drawn as text, grid rows longer than
  their header).
- **Variants** (`variants`): `resolve(source, { lookup, known })` parses a
  block and, when its first line is `extends: <id>`, applies it to the
  screen `lookup(id)` returns. Use `resolve` rather than `parse` for any
  block that may be a variant; its options are a `ResolveOptions`, with
  `lookup` a `Lookup`, and an optional `lineOf` that maps a base screen's
  lines for its errors. `extendsId(source)` reads that id;
  `serialize(tree)` turns a tree back into spec text.
- **Layout** (`layout`): `layout(tree, origin, env)` returns a
  `LayoutResult`, `{ ops: DrawOp[], size, boxes }`, where `boxes` maps the
  id of every component that has one to its `Box`. `env` is a `LayoutEnv`:
  a `measure` function, the text `style` (`fontSize`, and a numeric
  `fontFamily` that layout only passes on to `measure`), an optional
  `theme` (default `DEFAULT_THEME`) and an optional `maxWidth` to wrap
  grids, alerts and text to.
- **Screen layout** (`screen`): `layoutScreen(tree, options)` is `layout`
  with the defaults every surface shares: origin `0,0`, Excalifont
  (`EXCALIFONT`) at `FONT_SIZE`. Its `LayoutScreenOptions` are an optional
  `maxWidth` and `theme`.
- **Metrics** (`metrics`, `metrics-excalifont`): `tableMeasure` measures
  with the bundled Arimo advance table, and `unmeasured(text)` lists
  characters that table lacks. `fontMeasurer(font)` builds the same pair
  from any `FontMetrics`, such as `EXCALIFONT`, Excalifont's advances and
  kerning. Also `FONT_STACK`, `FONT_CSS`, `LINE_HEIGHT`, `ASCENT`,
  `DESCENT`.
- **Theme** (`theme`): `DEFAULT_THEME`, `DARK_COLORS`, `FONT_SIZE`, `INK`
  (a fill value meaning "the stroke colour"), and the ink colours for a
  light and a dark page, `LIGHT_INK` and `DARK_INK`.
- **Icons** (`icons`): `ICON_NAMES` and `isIcon(name)`.
- **Screens documents** (`screens`): a Markdown file whose `wiredown`
  fenced blocks are screens, each named by a `^id` line after its fence.
  `parseScreens(markdown)` returns every block as a `Screen` (its `id`, the
  `heading` above it, its `source` and the file `line` of its first line)
  and throws on an unclosed fence. `checkScreens(markdown, checkBlock)`
  checks every block with `checkBlock`, a `BlockCheck` (`check` unless a
  host compares another parser), resolving variants against the first
  block with each id, and returns a `CheckScreensResult`: the
  `CheckedScreen`s (each with its tree), and `errors` and `warnings` as
  `ScreenDiagnostic`s with file lines.
- **Types** (`types`): every type, including `SpecNode`, `ParseResult`,
  `DrawOp` and its four op kinds, `MeasureText`, `TextStyle` and `Theme`.

Draw ops carry geometry and colour overrides only. Stroke colour,
roughness and the like come from the host's canvas style when it renders
them.

## Fork notice

This package is a fork of the core of
[Sketchdown](https://github.com/magnushaggren/sketchdown) by Magnus Haggren,
at commit `e790382`, used under the MIT licence. The upstream copyright
notice is preserved in this package's [LICENSE](LICENSE).

`tests/fixtures/prototype/Sketchdown.md` is Sketchdown's original
single-script prototype, kept unchanged because the compatibility test runs
its parser against the v2 fixture specs.

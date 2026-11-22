# @wiredown/core

Wiredown's parser, variant resolution, layout and text metrics. It has no DOM
and no Excalidraw dependency: layout turns a text spec into positioned draw
operations, measuring text with Excalifont's bundled advance widths.

## Use

The package is private to this workspace. Depend on it with
`"@wiredown/core": "workspace:*"` and import from the package root; it has
no other entry points. Build it first (`pnpm build`): outside the
workspace's type-checking, imports resolve to `dist/`.

```ts
import { formatError, layoutScreen, resolve } from "@wiredown/core";

const spec = ["row:", "  button: Cancel", "  button: *Save"].join("\n");

const { tree, errors } = resolve(spec);
for (const error of errors) console.warn(formatError(error));

const { ops, size } = layoutScreen(tree);
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
  gives `line 3: …`. `nearest(word, known)` is the "did you mean" lookup.
- **Catalog** (`catalog`): `CATALOG`, a `CatalogEntry` for every component
  and variant directive: its node type, keywords, description, a minimal
  `example`, and the flags and number options it takes. `COMMON_FLAGS` are
  the flags every component takes.
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
- **Screen layout** (`screen`, `layout`): `layoutScreen(tree, options)`
  lays a tree out at origin `0,0` in Excalifont (`EXCALIFONT`, font family
  `EXCALIFONT_FAMILY`) at `FONT_SIZE`. It returns a `LayoutResult`,
  `{ ops: DrawOp[], size, boxes }`, where `boxes` maps the id of every
  component that has one to its `Box`. Its `LayoutScreenOptions` are an
  optional `theme` (default `DEFAULT_THEME`) and an optional `maxWidth` to
  wrap grids, alerts and text to.
- **Metrics** (`metrics`, `metrics-excalifont`): `fontMeasurer(font)`
  builds a text measurer from any `FontMetrics`, with a list of the
  characters its table lacks; `EXCALIFONT` holds Excalifont's advances and
  kerning. From the fork, unused by wiredown: `tableMeasure` measures with
  the bundled Arimo advance table, `unmeasured(text)` lists characters that
  table lacks, and `FONT_STACK`, `FONT_CSS`, `LINE_HEIGHT`, `ASCENT` and
  `DESCENT` go with it.
- **Theme** (`theme`): `DEFAULT_THEME`, `FONT_SIZE`, `INK` (a fill value
  meaning "the stroke colour"), and the ink colours for a light and a dark
  page, `LIGHT_INK` and `DARK_INK`. `DARK_COLORS` are the theme colours for
  a dark page (from the fork, unused by wiredown).
- **Icons** (`icons`): `ICON_NAMES`.
- **Screens documents** (`screens`): a Markdown file whose `wiredown`
  fenced blocks are screens, each named by a `^id` line after its fence.
  `parseScreens(markdown)` returns every block as a `Screen` (its `id`, the
  `heading` above it, its `source` and the file `line` of its first line)
  and throws on an unclosed fence. `checkScreens(markdown)` checks every
  block, resolving variants against the first block with each id, and
  returns a `CheckScreensResult`: the `CheckedScreen`s (each with its
  tree), and `errors` and `warnings` as `ScreenDiagnostic`s with file
  lines.
- **Types** (`types`): `SpecNode`, `ParseResult`, `ParseError`, `DrawOp`
  and `Theme`.

Draw ops carry geometry and colour overrides only. Stroke colour,
roughness and the like come from the host's canvas style when it renders
them.

## Metrics

`pnpm metrics` reads the installed `@excalidraw/utils` 0.1.8 Excalifont.ttf
using a small sfnt table reader. It regenerates advances for the web font's
Unicode ranges; a unit test checks the committed output byte for byte.
No font parser dependency is required. The font is Excalifont Regular 1.000,
licensed under SIL OFL 1.1.

Kerning covers printable ASCII pairs only. These are retained browser canvas
measurements against the web subsets, not regenerated by the advance reader.
After building, `node packages/core/scripts/check-metrics.mjs` compares sample
widths to headless Chromium canvas within 0.015 px after measuring at
1,000 px and scaling to 16 px, avoiding small-size font rounding. It uses
`@wiredown/gitea`'s Playwright and needs its Chromium installed
(`pnpm --filter @wiredown/gitea exec playwright-core install chromium-headless-shell`).

## Fork notice

This package is a fork of the core of
[Sketchdown](https://github.com/magnushaggren/sketchdown) by Magnus Haggren,
at commit `e790382`, used under the MIT licence. The upstream copyright
notice is preserved in this package's [LICENSE](LICENSE).

`tests/fixtures/prototype/Sketchdown.md` is Sketchdown's original
single-script prototype, kept unchanged because the compatibility test runs
its parser against the v2 fixture specs.

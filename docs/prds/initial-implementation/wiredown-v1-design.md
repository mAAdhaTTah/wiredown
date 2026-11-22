# Wiredown v1: design

Status: draft, 2026-11-16. Owner: mAAdhaTTah. To be built locally first, in a
private GitHub repo.

Wiredown is a toolkit for low-fidelity UX wireframes written as text,
rendered as hand-drawn Excalidraw sketches, and composed into user-flow
drawings. It's built to be written mostly by an AI coding agent and reviewed
by a person in Obsidian and in a Git forge (Gitea).

Supporting material in this folder:

- `syntax-proposal.md`: the screen syntax changes, with decisions D1–D3.
- `prototypes/`: working prototype code to start from (see "Starting
  points").

## Goals

- **Screens as text.** One fenced `wiredown` block per screen, in a compact
  line syntax an agent writes reliably and a person reads and edits in any
  editor. Diffable in Git.
- **One source of truth.** A screen exists only as its text block. Every
  flow, render and preview is drawn from it; nothing is copied.
- **Looks like Excalidraw everywhere.** Screens and flows share Excalidraw's
  strokes, font and theming, because Excalidraw draws both.
- **Flows stay flexible.** A flow is an ordinary Excalidraw drawing that the
  agent and the person both edit. Wiredown supplies screens and editing
  commands, not a rigid flow format.
- **Works headless.** An agent checks and renders its own work in Node, with
  no browser and no Obsidian.
- **Reviewable where people review.** Rendered in Obsidian and on Markdown
  pages in the forge.

## Non-goals for v1

- High-fidelity design, real component libraries, click-through prototypes.
- A hosted service or a live shared canvas.
- Integration with any particular agent harness. Wiredown provides a CLI and
  an agent skill; wiring them into an agent's workflow happens outside this
  repo.
- Rendering in forges that don't allow custom JavaScript (e.g. github.com);
  committed SVG exports remain possible there.

## How it fits together

```
screens.md ── ```wiredown blocks (^block-id) ──┐
                                               │  parse → resolve variants
                                               │  → layout (Excalifont metrics)
                                               ▼
                                  laid-out screen (boxes per #id)
                                               │  adapter
                                               ▼
                                  Excalidraw elements
                                               │  Excalidraw's own SVG export
              ┌────────────────────────────────┼───────────────────────────┐
              ▼                                ▼                           ▼
   Obsidian code block              Node (CLI: check, render,      Browser (@wiredown/gitea:
   (via the Excalidraw plugin)      lint, flow commands)           Gitea pages)

flows/*.excalidraw.md ── Excalidraw drawing; screens are image embeds
   [[screens#^id|WxH]] + arrows, decisions, notes, and overlays anchored
   to #ids inside screens
```

## Parts (one monorepo)

| Package | Responsibility |
|---|---|
| `@wiredown/core` | Parser, variant resolution, layout, Excalifont text metrics, per-component validation, errors with line numbers and "did you mean". No DOM, no Excalidraw dependency. Starts as a fork of Sketchdown's MIT core. |
| `@wiredown/excalidraw` | Laid-out screen → Excalidraw elements (rectangles, lines, ellipses, text). Elements → SVG through Excalidraw's export, in the browser and headless in Node. |
| `@wiredown/cli` | `wiredown check`, `render` (screen or flow → SVG/PNG), the flow-editing commands, `lint` for CI. JSON output for agents. |
| Obsidian plugin (`wiredown`) | Code-block processor for the `wiredown` fence. Draws through the Excalidraw plugin, which is a hard dependency: without it the block shows a clear error, no fallback. |
| `@wiredown/gitea` | Script for Gitea, added through its custom templates. Renders `wiredown` blocks and `.excalidraw.md` flows on Gitea's pages; loads Excalidraw only on pages that need it. Gitea only. |
| Agent skill | Syntax reference generated from core's component catalog (so it can't drift), authoring conventions, self-check workflow. |

## Screens

Syntax is Sketchdown's (one component per line, `keyword: content
(options)`, indentation nests, grid rows as plain `|` lines, `{icon}`,
`[link]`, `-grey-`, `*` for primary/selected), kept as a superset, plus the
changes in `syntax-proposal.md`:

- grids fill their container by default (`(fit)` opts out);
- variants: `extends: <id>`, then `replace:` / `remove:` / `after:` /
  `before:` / `rows:` (with `=` for unchanged cells); a variant line without
  a verb is an error;
- ids as `#id` (and `(id=x)`), unique per screen;
- `(focus)` for a highlight (but see "Interactions belong to flows");
- per-component option validation; an escape for text ending in an option
  word.

Conventions for `screens.md`:

- One heading per screen, then the `wiredown` block, then its block id line
  (`^team-members`). The id is how flows embed it.
- Notes about a screen itself (gaps such as "unspecified: what an expired
  invitation shows") are plain Markdown prose under the block. They travel
  with the screen to every flow that embeds it.
- Frontmatter carries the embed styling the Excalidraw plugin reads from the
  embedded file (`excalidraw-css`, `excalidraw-font`); the CLI writes it.
- Avoid characters missing from Excalifont (e.g. `⋯`); `check` flags them.

## Rendering: Excalidraw everywhere

Screens are drawn by Excalidraw, from elements Wiredown lays out. Same look
in every surface; no second renderer to keep in step.

- **Text measurement.** Layout measures in Excalifont with an advance-width
  table plus measured kerning pairs, generated from the font. The prototype
  matched Excalidraw's own `measureText` to 0.01 px mean, 0.96 px max.
  Excalifont is OFL-1.1; Wiredown ships derived metrics, and Excalidraw
  inlines the font.
- **Obsidian.** `window.ExcalidrawAutomate.getAPI()` → load elements →
  `createSVG`, which needs no open drawing and inlines Excalifont. When the
  Excalidraw plugin renders a block for an image embed, it snapshots after
  250 ms plus 150 ms of DOM stillness (2 s cap); the processor keeps the DOM
  busy until its export finishes.
- **Headless.** Node with happy-dom (or jsdom) and `@excalidraw/utils`, plus
  a small `FontFace` stub. 8 SVGs in 0.47 s, deterministic output (re-runs
  are byte-identical). No Chromium.
- **Web.** One bundle with `@excalidraw/excalidraw` renders screens and whole
  flows: about 1.15 MB gzipped, loaded only on pages with `wiredown` blocks
  or flows. A Rough.js-only screen renderer (~10 KB) stays a later option if
  page loads prove slow.
- **Theme.** Excalidraw renders light or dark at export time; each surface
  renders for its current theme.
- **Size.** 59–71 KB per screen SVG with the font inlined, 25–38 KB without.
  Rendered on demand, never committed.

## Flows

A flow is an Obsidian Excalidraw drawing (`flows/<name>.excalidraw.md`). It
is the source of truth for the flow; the agent and the person both edit it.

- **Screens are image embeds** of their blocks: `[[screens#^id|WxH]]`, sized
  from the layout. Checked in Obsidian: they render as wireframes, follow the
  theme, open the source block for editing, and appear in the plugin's SVG
  export. Editing happens only in `screens.md`, so drawings can't drift.
- **Embed paths.** A new embed names its screens file by the file's path
  from the root without `.md`: `[[docs/checkout/screens#^cart|388x209]]`.
  The root is the git repository's, else the Obsidian vault's, else the
  parent of the flow's folder. Commands that add screens take the screens
  file with `--screens`; there is no default file name. Readers also take
  `./` and `../` paths from the flow, and, as Obsidian does, a trailing part
  of a path (`screens`) that matches exactly one file; several matches are
  an error.
- **Editing commands, not a generator.** Each reads the current drawing,
  makes one targeted change and preserves everything else, including the
  person's edits:
  - `flow new` scaffolds a starting layout from a rough outline (once);
  - `flow add-screen <id> --right-of F2`, `flow connect F2 F3 "label"`,
    `flow note F2 "…"` place things relatively, so the agent never computes
    coordinates (hand-placed coordinates were the costliest part of
    agent-drawn Excalidraw in testing);
  - `flow refresh` updates embed sizes and anything anchored to a screen
    after its layout changes;
  - `flow lint` catches missing screens, stale sizes, dangling arrows.
- **Free-form drawing stays available.** The agent can write Excalidraw
  elements directly for anything the commands don't cover.
- **Element provenance.** New `customData.wiredown` records carry `v: 1`
  and `id`, equal to their element's id. A different `id` identifies a
  person's pasted copy, which flow commands leave alone and `flow lint`
  reports; existing data without `id` keeps its previous behaviour.
- **Frame labels** (F1, F2, …) let review comments in the forge refer to
  steps.

### Interactions belong to flows

A screen is reusable across flows, so the element a user interacts with is a
property of the flow step, not the screen.

- `flow highlight F2 #invite` draws an outline over that element inside F2's
  embed; `flow mark F2 #members 3` draws a numbered badge there. Positions
  come from the layout's box for each `#id`, scaled by the embed's size.
- Each overlay records its screen and `#id`; `flow refresh` moves overlays
  when the screen re-lays out.
- Screens stay neutral: they carry `#id`s, flows decide what to point at.
  The skill tells the agent to highlight in the flow, not with `(focus)`.
  `(mark=N)` is dropped from the screen syntax in favour of overlays.

## Using Wiredown

- **In an agent's workflow:** install the CLI and the agent skill. The agent
  writes `screens.md`, self-checks with `wiredown check` and `render`, and
  builds flows with the `flow` commands.
- **In Obsidian:** open the repo as a vault, with the Excalidraw plugin and
  the Wiredown plugin installed.
- **On Gitea:** load `@wiredown/gitea` through Gitea's custom templates,
  pinned to a version. `pnpm test:gitea` checks it on a pinned Gitea, and
  a Gitea bump re-runs it, since the script depends on the page's structure.
- **In CI:** run `wiredown lint` to catch syntax errors, broken screen
  references and stale embed sizes.
- **Layout in a repo:** `screens.md` and `flows/` together, for example next
  to the PRD or spec they illustrate.

## Distribution while private

- Repo: private on GitHub, single maintainer to start.
- Packages: a private npm registry (GitHub Packages, or a self-hosted
  registry). Anything that installs them needs a read token.
- Obsidian: BRAT from the private repo (unverified that BRAT supports private
  repos with a token) or manual install of `main.js`, `manifest.json`,
  `styles.css`. The community directory needs a public repo, so it waits.
- Licence: MIT. Keep Sketchdown's licence and credit (fork of
  `magnushaggren/sketchdown` at `e790382`). Consider telling its maintainer
  and offering generic fixes upstream.

## Name

Wiredown; fence, CLI and Obsidian id `wiredown`; packages `@wiredown/core`,
`@wiredown/excalidraw`, `@wiredown/cli`. Checked 2026-11-16: no npm package
`wiredown` or `@wiredown/*`; GitHub user/org `wiredown` free; no Obsidian
plugin by that name or id; `wiredown.dev`, `.app`, `.io`, `.org` show no
registration; `wiredown.com` is an unrelated site; trademarks not checked.
Unrelated GitHub repos named WireDown exist (network tools, a wellness site).
Neighbours in this niche: wiremd, wiremark, Wireloom, Wireframy. Runner-up
name: Framedown.

## Evidence

| Claim | Evidence | Status |
|---|---|---|
| Sketchdown's syntax and core are the right base | Hands-on comparison with tsquare and Wireloom on the same screens | Decided |
| Image embeds keep one source and render as wireframes | Checked in Obsidian | Confirmed |
| tsquare's plugin doesn't fit embeds | Embeds drawn as bitmaps (blurry when zoomed) and inverted in dark mode | Confirmed in Obsidian |
| Excalidraw renders screens in Obsidian, headless and in the browser | Prototype checked in Obsidian (2026-11-16); browser path simulated | Confirmed in Obsidian |
| Headless export works in Node | Prototype run, re-run 2026-11-16 | Confirmed |
| Excalifont metrics match Excalidraw | Prototype measurement | Measured |
| Variants, wrapping grids, validation work | Prototype fork, 1,024 tests passing | Prototyped |
| Overlays line up with elements inside embeds | Screen size and place inside the embed measured in headless Obsidian, for a screens file with the CLI's styling front matter (`pnpm test:obsidian`); not checked by eye | Measured |
| Gitea script | Bundle installed on Gitea 28.4.0 in Docker and checked in headless Chromium (`pnpm test:gitea`, in CI) | Measured |

## Open questions and risks

- **Embed timing.** The processor must finish within the Excalidraw plugin's
  snapshot window; the first render in a session is the slow case.
- **Overlay alignment.** Measured in headless Obsidian, not by eye. It
  holds for a screens file that keeps the styling front matter the CLI
  writes.
- **Owning a fork alone.** Upstream Sketchdown is young with one maintainer;
  little to lean on.
- **Excalidraw upgrades.** Two Excalidraw builds are involved (the Obsidian
  plugin's fork and npm's); their output can diverge.
- **Syntax test.** `syntax-proposal.md` "How to test it" runs once P2, P3, P5
  and P7 exist.

## Starting points

- `prototypes/sketchdown-fork/`: the fork with the Excalidraw path. Includes
  variants (`extends`, `rows:`, `remove:`, `after:`), wrapping grids, `(hi)`
  highlight, per-option validation, `//` comments, Arimo and Excalifont
  metrics (`src/core/metrics*.ts`), the elements adapter
  (`src/adapters/excalidrawElements.ts`), and its tests. Not yet
  implementing the syntax proposal (`replace:`, `#id`, `(focus)`, grid fill
  default, catalog). Upstream licence kept; `node_modules`/`dist` excluded.
- `prototypes/obsidian-plugin/`: prototype plugin (fence `wireframe-x`)
  drawing through the Excalidraw plugin.
- `prototypes/excalidraw-render-scripts/`: headless export
  (`node-export.mjs`, needs `--fontface-stub`), metrics builders, the web
  bundle entry and build, an Obsidian simulation.
- `prototypes/flow-tools/`: earlier flow prototypes: `ux.mjs` (flow
  generation, sync, lint against frontmatter), `gen-embeds.mjs` (writes
  `[[screens#^id|WxH]]` image embeds in the confirmed format),
  `validate-embeds.mjs` (the Excalidraw plugin's own parsing rules).

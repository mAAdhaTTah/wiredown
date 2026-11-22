# Wiredown

Wiredown is a toolkit for low-fidelity UX wireframes written as text,
rendered as hand-drawn Excalidraw sketches, and composed into user-flow
drawings. It is built to be written mostly by an AI coding agent and reviewed
by a person in Obsidian and in a Git forge.

Packages are listed below. `@wiredown/gitea` is tested on a real Gitea
(`pnpm test:gitea`).

| Package                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `@wiredown/core`       | Parser, variants, layout, text metrics, and validation                      |
| `@wiredown/excalidraw` | Excalidraw elements and headless SVG and PNG export                         |
| `@wiredown/cli`        | `wiredown check`, `render` to SVG or PNG, `flow` commands and `lint` for CI |
| `@wiredown/obsidian`   | Obsidian code-block processor                                               |
| `@wiredown/gitea`      | Script that renders blocks and flows on Gitea's pages                       |

## Development

Install the pinned tools with mise, then run:

```sh
mise install
pnpm install
pnpm format:check
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

`pnpm format` applies formatting. Build and typecheck run each package's
scripts; tests run all package projects through the root Vitest config.
In type-checking and unit tests, workspace package imports resolve to their
source; the CLI bin, the bundles and code that imports a `dist/` path use
the build. The evals import core's built `dist/internal.js`, so run
`pnpm build` before `pnpm typecheck` and `pnpm test`.
After a build, `pnpm exec wiredown` runs the CLI from the repository root.

`pnpm test:obsidian` builds the wiredown Obsidian plugin, then opens flows
in real Obsidian with it and the Excalidraw plugin, headless. It checks that
the Excalidraw plugin reads them as `parseFlow` does and keeps what
`serializeFlow` wrote when it saves, that flows built by commands keep
their frames where Obsidian draws the screens and save lint-clean with
nothing to refresh, and what the wiredown plugin draws in notes. It downloads the versions pinned in
`packages/excalidraw/tests/obsidian/obsidian.ts` on first run and needs
Linux x64. CI runs it too.
TypeScript 6 is used because typescript-eslint does not yet support
TypeScript 7.

Packages extend `tsconfig.base.json` and build with Vite to `dist/`.
The Obsidian plugin and `@wiredown/gitea` are bundles. The plugin's dist
folder is installable; `@wiredown/gitea`'s dist is a Gitea custom directory,
installed by copying it into `$GITEA_CUSTOM`.

The design and syntax proposal live in `docs/prds/initial-implementation/`.
[packages/evals](packages/evals/README.md) holds a manual eval of how well a
model writes screens from the skill's reference (`pnpm eval`; never run in CI).

## Credit

Wiredown's core (`packages/core`) is forked from
[Sketchdown](https://github.com/magnushaggren/sketchdown) at commit `e790382`,
by Magnus Haggren. Wiredown is MIT licensed; the upstream copyright notice
is preserved in [packages/core/LICENSE](packages/core/LICENSE).

## Agent skill

[skills/wiredown](skills/wiredown/SKILL.md) guides agents writing screens and
flows; the `wiredown` CLI must be on PATH. The directory is self-contained
at use time, and `@wiredown/cli` ships a copy in `dist/skills/wiredown`.
Install it in a project in one of these ways:

- `wiredown skill` copies the CLI's copy to `.agents/skills/wiredown` and
  links it from `.claude/skills` and other agent folders (see the
  [CLI README](packages/cli/README.md#skill)).
- `npx skills add mAAdhaTTah/wiredown` installs it from this repository.
- With `@wiredown/cli` a dependency of the project,
  `npx skills experimental_sync` links the installed package's copy.

After building, run `pnpm skill` to regenerate its syntax reference:
`reference/syntax.md` (the grammar, escapes and an index) and one file per
component category under `reference/components/`. The component sections
come from core's catalog; the categories, grammar, escapes and variants
text are written in `scripts/skill.mjs`, where tests check its examples.
Tests fail if the committed reference is out of date.

Run `pnpm metrics` to regenerate Excalifont advance widths from the installed
`@excalidraw/utils` font. After building, run
`node packages/core/scripts/check-metrics.mjs` with Playwright Chromium
installed to check sample canvas widths. Kerning retains browser-measured
ASCII pairs; the generator does not regenerate those measurements.

The Excalidraw main entry has only browser-safe dependencies. Its Node-only
packages are optional peers, installed by the CLI and as adapter development
dependencies. Consumers of `@wiredown/excalidraw/node` must install them.

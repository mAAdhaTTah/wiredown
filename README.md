# Wiredown

Wiredown is a toolkit for low-fidelity UX wireframes written as text,
rendered as hand-drawn Excalidraw sketches, and composed into user-flow
drawings. It is built to be written mostly by an AI coding agent and reviewed
by a person in Obsidian and in a Git forge.

Packages are listed below. `@wiredown/gitea` is built and tested in happy-dom
but has not yet run on Gitea or in a real browser.

| Package                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `@wiredown/core`       | Parser, variants, layout, text metrics, and validation                      |
| `@wiredown/excalidraw` | Excalidraw elements and headless SVG and PNG export                         |
| `@wiredown/cli`        | `wiredown check`, `render` to SVG or PNG, `flow` commands and `lint` for CI |
| `@wiredown/obsidian`   | Obsidian code-block processor                                               |
| `@wiredown/gitea`      | Script that renders blocks and flows on Gitea's pages (unverified)          |

## Development

Install the pinned tools with mise, then run:

```sh
mise install
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm format` applies formatting. Build and typecheck run each package's
scripts; tests run all package projects through the root Vitest config.
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

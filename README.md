# Wiredown

Wiredown is a toolkit for low-fidelity UX wireframes written as text,
rendered as hand-drawn Excalidraw sketches, and composed into user-flow
drawings. It is built to be written mostly by an AI coding agent and reviewed
by a person in Obsidian and in a Git forge.

Packages (`@wiredown/core` and `@wiredown/excalidraw` exist so far; the rest
are planned):

| Package                    | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `@wiredown/core`           | Parser, variants, layout, text metrics, and validation |
| `@wiredown/excalidraw`     | Excalidraw elements (SVG export is planned)            |
| `@wiredown/cli`            | Headless checks, rendering, and flow commands          |
| `packages/obsidian-plugin` | Obsidian code-block processor                          |
| `@wiredown/web`            | Rendering for Markdown hosts, starting with Gitea      |

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
TypeScript 6 is used because typescript-eslint does not yet support
TypeScript 7.

Packages extend `tsconfig.base.json` and build with Vite to `dist/`.

The design and syntax proposal live in `docs/prds/initial-implementation/`.

## Credit

Wiredown's core (`packages/core`) is forked from
[Sketchdown](https://github.com/magnushaggren/sketchdown) at commit `e790382`,
by Magnus Haggren. Wiredown is MIT licensed; the upstream copyright notice
is preserved in [packages/core/LICENSE](packages/core/LICENSE).

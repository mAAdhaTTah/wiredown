# Wiredown

Wiredown is a toolkit for low-fidelity UX wireframes written as text,
rendered as hand-drawn Excalidraw sketches, and composed into user-flow
drawings. It is built to be written mostly by an AI coding agent and reviewed
by a person in Obsidian and in a Git forge.

This repository currently contains the workspace scaffold. Planned packages:

| Package                    | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `@wiredown/core`           | Parser, variants, layout, text metrics, and validation |
| `@wiredown/excalidraw`     | Excalidraw elements and SVG export                     |
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
`packages/placeholder` is an empty private package because Vitest requires a
matching project even with `passWithNoTests`. Remove it when the first real
package lands. TypeScript 6 is used because typescript-eslint does not yet
support TypeScript 7.

Packages will extend `tsconfig.base.json` and compile with `tsc` to `dist/`.

The design and syntax proposal live in `docs/prds/initial-implementation/`.

## Credit

Wiredown's core will be forked from
[Sketchdown](https://github.com/magnushaggren/sketchdown) at commit `e790382`,
by Magnus Haggren. Wiredown is MIT licensed; the upstream copyright notice
will be kept with the core package when it lands.

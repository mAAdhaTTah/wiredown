# Contributor rules

- Use pnpm; Node and pnpm versions are pinned in `mise.toml`.
- Use strict TypeScript and ESM. Extend `tsconfig.base.json` in packages.
- Build every package with Vite (`vite build`) to `dist/`; `tsc --noEmit`
  only type-checks. Relative imports have no extension (`./parse`).
- Use Vitest. Tests live in `packages/<name>/tests`.
- Keep code clear and succinct. Avoid overengineering and do not build for
  use cases the design does not call for.
- `@wiredown/core` has no DOM and no Excalidraw dependency.
- Design documents live in `docs/prds/initial-implementation/`; read the
  design and syntax proposal before changing product behavior.
- Hard-wrap prose Markdown at about 80 columns.
- Prettier sorts imports; run `pnpm format` rather than ordering by hand.
  `packages/core` is exempt: it keeps the import order of the Sketchdown
  code it was forked from, so fixes can go upstream.

## Commands

```sh
pnpm install
pnpm format          # Apply formatting
pnpm format:check
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

Build and typecheck recurse through workspace package scripts. The root
Vitest config discovers package projects in `packages/*`. In type-checking
and unit tests, a workspace package import resolves to the package's source
(the `@wiredown/source` export condition). Node, the bundles and code that
imports a `dist/` path use the built output. The evals import core's built
`dist/internal.js`, so build before typecheck and test.

Evals (`packages/evals/evals/*.eval.ts`, `pnpm eval`) call a model through
`claude -p` and cost money. Run them only by hand when asked; never add them
to `pnpm test` or CI. Their unit tests (`packages/evals/tests`) are ordinary
tests and do run in `pnpm test`.

Run `pnpm metrics` to regenerate Excalifont advance widths from the installed
`@excalidraw/utils` font. After building, run
`node packages/core/scripts/check-metrics.mjs` with Playwright Chromium
installed to check sample canvas widths. Kerning retains browser-measured
ASCII pairs; the generator does not regenerate those measurements.

The Excalidraw main entry has only browser-safe dependencies. Its Node-only
packages are optional peers, installed by the CLI and as adapter development
dependencies. Consumers of `@wiredown/excalidraw/node` must install them.

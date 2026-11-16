# Contributor rules

- Use pnpm; Node and pnpm versions are pinned in `mise.toml`.
- Use strict TypeScript and ESM. Extend `tsconfig.base.json` in packages.
- Build packages with plain `tsc` to `dist/`, except the Obsidian plugin
  and `@wiredown/web`, which bundle with esbuild.
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
pnpm typecheck
pnpm build
pnpm test
```

Build and typecheck recurse through workspace package scripts. The root
Vitest config discovers package projects in `packages/*`. Type-checking and
unit tests read workspace packages from source (the `@wiredown/source` export
condition); build before tests that use built output.

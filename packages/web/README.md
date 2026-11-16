# @wiredown/web

A browser script for Markdown hosts that allow custom JavaScript. It draws
`wiredown` code blocks and `.excalidraw.md` flows on a page with Excalidraw,
and loads Excalidraw only on pages that have one. Gitea is the only host it
knows.

**Status: built and tested in happy-dom only. It has never run on a Gitea
instance or in a real browser.** See "Verify on a forge" below.

## Files

`pnpm build` writes `dist/`:

| File                   | What it is                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `wiredown.js`          | The loader. A classic script, about 2 KB, no dependencies.    |
| `wiredown-renderer.js` | The renderer, an ES module the loader imports on demand.      |
| `chunks/`              | Excalidraw and React, split into chunks the renderer imports. |
| `fonts/Excalifont/`    | The font Excalidraw inlines into each drawing, and `OFL.txt`. |

The loader runs on every page. On DOM ready, and whenever the page adds
content later (comments, previews), it looks for `wiredown` blocks and a
rendered flow. If there are none it does nothing else. Otherwise it imports
`wiredown-renderer.js` from its own folder, once, and hands it what it found.

Sizes (esbuild 0.27, `@excalidraw/excalidraw` 0.18.1, React 18.3.1):

| Download                                            | Minified | Gzip    |
| --------------------------------------------------- | -------- | ------- |
| `wiredown.js`, on every page                        | 2.2 KB   | 1.2 KB  |
| `wiredown-renderer.js`                              | 82 KB    | 31 KB   |
| Renderer and the chunks one drawing used (13 files) | 3.06 MB  | 1.14 MB |
| Renderer and every chunk (181 files)                | 8.2 MB   | 2.6 MB  |

The first two rows and the last are printed by `pnpm build`. The third was
measured once by exporting a screen with the built renderer in Node under
happy-dom and recording which files were loaded. That run also fetched one
25 KB Excalifont file. It matches the design's estimate of about 1.15 MB
gzipped. A real browser may load somewhat different chunks; for example, it
may subset the font in a worker. This has not been measured.

## Loading it

Host the whole `dist/` folder on the forge's own origin, in a folder named
after the version. Then add one tag to every page:

```html
<script src="/assets/wiredown/0.1.0/wiredown.js" defer></script>
```

- It must be a classic script, not `type="module"`. The loader finds its
  own URL through `document.currentScript`, and loads the renderer and fonts
  from the same folder.
- Pin a version. Each loader loads the renderer next to it, so a versioned
  folder keeps the two in step. Upgrading means a new folder and a new tag.
- It makes no requests except to the page's own origin: the renderer and
  fonts, a Markdown file's raw text, and a flow's raw text and screens files.
  It reads cookies only as the page's own `fetch` does (`same-origin`). It
  sets one global, `EXCALIDRAW_ASSET_PATH`, which Excalidraw reads to find
  its fonts (unless the page has already set it).

### Other fonts

Only Excalifont is shipped. Excalidraw loads a font family from
`fonts/<Family>/` under `EXCALIDRAW_ASSET_PATH`, which is the loader's own
folder unless the page set it. To use another of Excalidraw's families,
copy its folder from `@excalidraw/excalidraw/dist/prod/fonts/` (for
example `Virgil/`) into `fonts/` next to `wiredown.js`, and list the
folders on the tag:

```html
<script src="/assets/wiredown/0.1.0/wiredown.js" data-fonts="Virgil,Nunito" defer></script>
```

The names are the folder names: `Virgil`, `Cascadia`, `Nunito`, `Lilita`,
`ComicShanns` and `Liberation`. Text in a family not listed (and not
Helvetica, which is the browser's local font) is drawn in Excalifont and
reported under "Not drawn:" as drawn in a fallback font, so no request is
made for a font that is not there. The renderer does not check that a
listed folder exists. Check each font's licence before serving it.

### On Gitea (unverified)

The prototypes and notes assume Gitea's custom templates. The usual place,
not checked on a live Gitea, is:

- `dist/` copied to `$GITEA_CUSTOM/public/assets/wiredown/<version>/`,
  served as `/assets/wiredown/<version>/`;
- the `<script>` tag above in `$GITEA_CUSTOM/templates/custom/footer.tmpl`.

A Content Security Policy that blocks same-origin module scripts, dynamic
`import()`, workers or `data:` images would stop it. Gitea's own policy was
not checked.

## What it assumes about the page

Everything host-specific is in `src/gitea.ts`, behind the `Host` interface
in `src/host.ts`:

| `Host` method     | Gitea assumption                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `findBlocks(doc)` | A block is `pre > code.language-wiredown`, maybe in `.code-block-container`; a following paragraph whose text is `^id` is its id. |
| `findFlow(doc)`   | The URL is a file view ending in `.excalidraw.md`; its rendered Markdown is `.file-view.markup`.                                  |
| `noteUrl(doc)`    | On a `.md` file view, the raw file is the page URL with `/raw/` for `/src/`.                                                      |
| `theme(doc)`      | `<html data-theme>` names containing `dark` are dark; `auto` follows the OS.                                                      |

The selectors and theme rule come from the round-2 page-script prototype.
The file-view and raw URLs are new and come from no prototype.

## What it does

- **Screens.** Each block becomes a `.wiredown-block` with the drawing. The
  original code block is moved, unchanged, into a `<details>` "Source" under
  it. Errors appear as `line N: message` with the code block left visible;
  warnings appear in small text under the drawing.
- **Variants.** On a Markdown file view, the renderer reads the raw file and
  checks it as the CLI does, so `line N` is a file line. Elsewhere (comments,
  pull request descriptions, READMEs in folder views), and whenever a block
  is not found in the file, it checks the blocks on the page, with ids from
  the `^id` paragraphs, and `line N` is a line in the block.
- **Flows.** On an `.excalidraw.md` file view, the renderer reads the raw
  file with `parseFlow`. Each embed `[[path#^id]]` names its screens file
  by the CLI's rule as far as a browser can apply it (`resolveEmbedPath` in
  `@wiredown/excalidraw`), within the repository's raw-content root
  (`.../raw/<kind>/<ref>/`; for a ref containing `/`, its first segment):
  `./x` and `../x` from the flow's folder; any other path from the root,
  then, since a browser cannot list the repository, as a trailing part of a
  path from the flow's folder and each folder above it, nearest first. A
  path that is absolute, has a `..` segment without starting `./` or `../`,
  or leads outside the root is not fetched at all. Each candidate is a
  same-origin fetch, tried in order; the first that exists is used. It
  draws each embedded screen as a padded SVG image and the whole drawing
  above the rendered Markdown, collapsed into a closed
  `<details class="wiredown-source">` named "Source". If drawing fails, the
  original content remains visible. Screens it cannot draw, and embeds
  whose file was not found or that point outside the root, are listed under
  the drawing.
- **Theme.** It draws for the page's theme at render time. Switching theme
  later does not redraw.
- **Failures.** If the renderer cannot load, a fetch fails or Excalidraw
  throws, the page's content stays as it was, a short `.wiredown-notice`
  appears next to it, and one `console.warn` is logged.

## Limitations

- github.com and other forges without custom JavaScript are not supported.
- Only Gitea's page structure is known, and it is assumed, not verified.
- Flows and file-accurate variants need same-origin access to raw files.
- Only Excalifont is shipped (see "Other fonts"). Text in another family
  is drawn in Excalifont with a fallback diagnostic under "Not drawn:".
  Helvetica uses the browser's local font, as in Excalidraw.
- The `^id` of a block in a comment is found only if Gitea renders the
  `^id` line as the next paragraph; otherwise variants there do not resolve.

## Verify on a forge (NOT YET RUN)

On a Gitea instance, after an install or a Gitea upgrade:

1. A page with no wireframe requests `wiredown.js` and nothing else from
   wiredown (browser network panel).
2. A Markdown file with two `wiredown` blocks, one a variant of the other,
   draws both; the variant shows its change; "Source" opens the code.
3. A block with an error shows `line N: message` with the file's line, and
   the code.
4. The same blocks in a pull request comment draw, including after posting
   a new comment without reloading.
5. A `flows/*.excalidraw.md` file view draws the flow above the Markdown,
   with every screen; renaming a screen id shows it under "Not drawn".
6. Dark theme: drawings are drawn dark after a reload.
7. No request leaves the forge's origin, and the console has no errors.
8. Add a note in Virgil: it is drawn in Excalifont with a "fallback font"
   notice and no font request. With Virgil added (see "Other fonts"), it is
   drawn in Virgil, loaded from the forge without a 404.
9. With the renderer file removed, blocks stay as code with a notice.

## Development

```sh
pnpm build       # node build.mjs: both bundles, fonts, size report
pnpm typecheck
pnpm test        # from the repository root
```

`tests/integration.test.ts` runs the built renderer with Excalidraw's real
exporter under happy-dom, with canvas and `FontFace` stubbed.

Drawing-supplied image files must use inline `data:` URLs with media type
`image/png`, `image/jpeg`, `image/gif`, `image/webp`, or `image/svg+xml`
(case-insensitive, base64 or plain). Other URLs, media types, and missing or
non-string values are dropped and listed under "Not drawn:"; image elements
remain as placeholders. Generated screen SVGs are unaffected. SVG data URLs
remain images inside Excalidraw's SVG export: the browser smoke observes no
external fetch from an SVG's nested external image reference.

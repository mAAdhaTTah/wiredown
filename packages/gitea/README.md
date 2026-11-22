# @wiredown/gitea

A script for Gitea, added to every page through Gitea's custom templates. It
draws `wiredown` code blocks and `.excalidraw.md` flows on Gitea's pages with
Excalidraw, and loads Excalidraw only on pages that have one. It supports
Gitea only.

**Status: run in Playwright's headless Chromium (last on 2026-11-17, with
159.0.8154.6; the smoke check prints the version it runs) against
Gitea-shaped stand-in pages; never run on a live Gitea.** See "Verify on
Gitea" below.

The browser run drew two screens (including a variant resolved from the raw
file) and a flow with both embedded screens, a highlight, a mark and a note,
in light and dark themes. Excalifont `@font-face` was inlined. The five
successful pages had no console errors, page errors, failed requests or
requests to another origin. The architect's initial run requested only the
loader on the plain page (1 asset request), and about 20 assets on drawing pages.
The reproducible script prints current counts, which may vary with font
subsetting. It also checks that a deliberate raw-file HTTP 500 preserves the
original content and shows a notice (the expected HTTP console error is
allowed only for that page).
The flow's note is in Virgil: it is drawn in Excalifont with the fallback
notice and no Virgil request, and in Virgil when the loader tag lists it in
`data-fonts` and the site serves its folder.

## Files

`pnpm build` writes `dist/` laid out as a Gitea custom directory (see
"Installing on Gitea"):

```text
dist/
  templates/custom/footer.tmpl        the tag that loads wiredown.js on every page
  public/assets/wiredown/<version>/   served by Gitea as /assets/wiredown/<version>/
```

The version folder holds:

| File                   | What it is                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `wiredown.js`          | The loader. A classic script, about 2 KB, no dependencies.    |
| `wiredown-renderer.js` | The renderer, an ES module the loader imports on demand.      |
| `chunks/`              | Excalidraw and React, split into chunks the renderer imports. |
| `fonts/Excalifont/`    | The font Excalidraw inlines into each drawing.                |

The loader runs on every page. On DOM ready, and whenever the page adds
content later (comments, previews), it looks for `wiredown` blocks and a
rendered flow. If there are none it does nothing else. Otherwise it imports
`wiredown-renderer.js` from its own folder, once, and hands it what it found.

Sizes (Vite 8.3, `@excalidraw/excalidraw` 0.18.1, React 18.3.1):

| Download                                            | Minified | Gzip    |
| --------------------------------------------------- | -------- | ------- |
| `wiredown.js`, on every page                        | 2.4 KB   | 1.2 KB  |
| `wiredown-renderer.js`                              | 90 KB    | 33 KB   |
| Renderer and the chunks one drawing used (13 files) | 3.06 MB  | 1.14 MB |
| Renderer and every chunk (182 files)                | 7.9 MB   | 2.6 MB  |

`pnpm build` prints the size of each file; the last row is their sum. The
third was measured once in Chromium: the JavaScript a page with two screens
loaded besides the loader. That page also fetched one 25 KB Excalifont
file. It matches the design's estimate of about 1.15 MB gzipped. Other
pages may load somewhat different chunks. The browser smoke check below prints current asset request counts.

## Installing on Gitea

Copy everything in `dist/` into Gitea's custom directory (`$GITEA_CUSTOM`)
and restart Gitea:

```sh
cp -R dist/. "$GITEA_CUSTOM/"
```

**This replaces `$GITEA_CUSTOM/templates/custom/footer.tmpl`.** Gitea has
one such file. If you already have one, add the line from
`dist/templates/custom/footer.tmpl` to yours instead of copying it.

`footer.tmpl` holds one tag:

```html
<script src="{{AppSubUrl}}/assets/wiredown/<version>/wiredown.js" defer></script>
```

`{{AppSubUrl}}` is Gitea's base path, empty unless Gitea is served under a
sub-path. None of this has been checked on a live Gitea: that Gitea serves
`$GITEA_CUSTOM/public/assets/` at `/assets/`, that `footer.tmpl` is added to
every page, that `AppSubUrl` is available in it, or whether a restart is
needed.

- It must be a classic script, not `type="module"`. The loader finds its
  own URL through `document.currentScript`, and loads the renderer and fonts
  from the same folder.
- Each version has its own folder, and the loader loads the renderer next to
  it, so the two stay in step. Upgrading copies a new folder and a new
  `footer.tmpl`; an old version's folder can then be deleted.
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
folders on the tag in `footer.tmpl`:

```html
<script
  src="{{AppSubUrl}}/assets/wiredown/<version>/wiredown.js"
  data-fonts="Virgil,Nunito"
  defer
></script>
```

The names are the folder names: `Virgil`, `Cascadia`, `Nunito`, `Lilita`,
`ComicShanns` and `Liberation`. Text in a family not listed (and not
Helvetica, which is the browser's local font) is drawn in Excalifont and
reported under "Not drawn:" as drawn in a fallback font, so no request is
made for a font that is not there. The renderer does not check that a
listed folder exists.

### Content Security Policy (unverified)

A strict Content Security Policy works if it allows, from the page's own
origin, scripts (module scripts and dynamic `import()`), `fetch` and workers,
and allows inline styles and `data:` images and fonts: the renderer adds a
`<style>` element, and each drawing is an SVG with its font inlined and its
screens as `data:` images. For example:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:
```

It needs no `'unsafe-eval'`. Without it, Excalidraw cannot subset the font
(its subsetting code compiles with `new Function`): it logs console errors,
in its worker and then on the page, and inlines the whole font instead, so
drawings look the same and are larger. Excalidraw has no option to skip
subsetting. Gitea's own policy was not checked.

## What it assumes about the page

Everything it reads from the page is in `src/gitea.ts`:

| Function          | Gitea assumption                                                                                                                  |
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
  the drawing. A flow whose frames were sized for older screens is drawn as
  it is, squeezed into those sizes, with a notice under it: "This flow is out
  of date with its screens; run wiredown flow refresh."
- **Theme.** It draws for the page's theme when the loader finds the
  wireframes. Switching theme later does not redraw.
- **Failures.** If the renderer cannot load, a fetch fails or Excalidraw
  throws, the page's content stays as it was, a short `.wiredown-notice`
  appears next to it, and one `console.warn` is logged.

## Limitations

- Only Gitea is supported, and its page structure is assumed, not verified.
- Flows and file-accurate variants need same-origin access to raw files.
- Only Excalifont is shipped (see "Other fonts"). Text in another family
  is drawn in Excalifont with a fallback diagnostic under "Not drawn:".
  Helvetica uses the browser's local font, as in Excalidraw.
- The `^id` of a block in a comment is found only if Gitea renders the
  `^id` line as the next paragraph; otherwise variants there do not resolve.

## Verify on Gitea (NOT YET RUN)

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
7. No request leaves Gitea's origin, and the console has no errors.
8. Add a note in Virgil: it is drawn in Excalifont with a "fallback font"
   notice and no font request. With Virgil added (see "Other fonts"), it is
   drawn in Virgil, loaded from Gitea without a 404.
9. With the renderer file removed, blocks stay as code with a notice.

## Development

```sh
pnpm build       # vite build: both bundles, fonts, file sizes
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

### Browser smoke check

```sh
pnpm smoke:gitea
# Optional screenshot directory and explicit browser:
pnpm smoke:gitea --out /tmp/wiredown-shots --browser /path/to/chromium
```

The root command builds first. After building, the package command is
`pnpm --filter @wiredown/gitea smoke --out /tmp/wiredown-shots`.
`--browser` takes precedence over `WIREDOWN_SMOKE_BROWSER`; otherwise
Playwright uses its installed headless Chromium, honoring
`PLAYWRIGHT_BROWSERS_PATH` or its standard cache. If none is installed, run
`pnpm --filter @wiredown/gitea exec playwright-core install chromium-headless-shell`.
Installing dependencies downloads no browser. Screenshots default to a temp
directory printed at the end; the generated site is always cleaned up.

CI runs this script after `pnpm test`; it is not part of `pnpm test`. Its
Gitea-shaped HTML stands in for the assumptions in `src/gitea.ts`; it does not verify live
Gitea selectors, custom templates or Gitea's own CSP. One page is served
with a strict policy (the example in "Content Security Policy", on every
response): it must
draw, with its fonts and styles applied, and only Excalidraw's known font
subsetting errors are allowed in its console.

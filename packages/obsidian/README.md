# Wiredown for Obsidian

Renders `wiredown` code blocks as Excalidraw SVGs in notes and flow embeds.
The Excalidraw community plugin is a hard dependency. Install and enable it;
without it Wiredown shows an error and the source, and draws the block once
Excalidraw is enabled. There are no settings or commands. Variants resolve
against block ids in the same note.

## Manual private installation

From the repository root, run `pnpm install` and `pnpm build`. Copy the
contents of `packages/obsidian/dist/` into
`<vault>/.obsidian/plugins/wiredown/` (main.js, manifest.json, styles.css).
Reload Obsidian and enable Wiredown in Community plugins. Repeat after
updates. No versions.json is required for manual installation; private BRAT
installation remains unverified.

The CLI writes this frontmatter to `screens.md`:

```yaml
excalidraw-font: Helvetica
excalidraw-css: ".excalidraw-md-host{padding:0 10px!important}.excalidraw-md-footer{height:5px!important}.wiredown-block svg{display:block}"
```

Helvetica prevents an extra Cascadia font being added to image embeds. The
CSS fixes the padding and footer Excalidraw gives an embed, and because it
mentions `svg` the Excalidraw plugin draws no border around the embed, so a
screen embeds at the same size and place whatever the plugin's settings
are. The screen SVG itself embeds Excalifont. Exports stay light; CSS
filters dark notes immediately, while the drawing handles its embedded
images' theme.

## Checked in Obsidian

`pnpm test:obsidian` runs real Obsidian, headless, with this plugin and the
Excalidraw plugin (versions pinned in
`packages/excalidraw/tests/obsidian/obsidian.ts`), and checks:

- in reading view and live preview, base and variant blocks render as
  `.wiredown-block[data-renderer="excalidraw"]` with an SVG that embeds
  Excalifont;
- a variant redraws when its base changes;
- dark notes apply the dark filter and light notes do not;
- invalid blocks show their errors and source, and warnings show under the
  screen;
- without the Excalidraw plugin a block shows the dependency error and
  source, and draws once the plugin is enabled;
- no errors are logged, including when the plugin unloads;
- in flows built by the CLI, each screen embed renders on first open of a
  fresh vault at the size the flow commands assume, with the screen at the
  place overlays assume.

The window is 200x150 and nothing is checked by eye. Unit tests use a fake
exporter.

## Check by eye

1. Toggle Obsidian's theme; screens should change immediately and look
   right.
2. Embed blocks in a flow with `[[screens#^id|WxH]]` at a normal window
   size; no blank, code-only, cropped or scaled images on first load.
3. Zoom beyond 300%; text and strokes should remain sharp.
4. Check all four note/drawing theme combinations: embeds must follow the
   drawing theme and match its labels' font.
5. Edit a base screen and its variant; both flow embeds should update.
   Double-click an embed and confirm that it opens the source block.
6. Export the drawing as SVG in light and dark mode; check embedded screens.

The 60 ms DOM heartbeat keeps Excalidraw's embed snapshot (250 ms plus
150 ms of stillness, 2 s cap) waiting while a screen exports; a slower
export can exceed the cap.

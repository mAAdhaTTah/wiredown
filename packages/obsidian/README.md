# Wiredown for Obsidian

Prototype behavior carried over but unverified in this build includes SVG
export and font embedding, export caching, embed timing and re-entrancy,
startup readiness, theme filtering, and Obsidian lifecycle integration.

Renders `wiredown` code blocks as Excalidraw SVGs in notes and flow embeds.
The Excalidraw community plugin is a hard dependency. Install and enable it;
without it Wiredown shows an error and the source. There are no settings or
commands. Variants resolve against block ids in the same note.

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
excalidraw-border-color: ""
```

Helvetica prevents an extra Cascadia font being added to image embeds. The
CSS fixes the padding and footer Excalidraw gives an embed, and the empty
border colour turns its black border off, so a screen embeds at the same
size and place whatever the Excalidraw plugin's settings are. The
screen SVG itself embeds Excalifont. Exports stay light; CSS filters dark
notes immediately, while the drawing handles its embedded images' theme.

## Verify in Obsidian — NOT YET RUN for this build

1. Open a note with base and variant `wiredown` fences and block ids.
   Check reading view and live preview. Inspect `.wiredown-block` elements
   for `data-renderer="excalidraw"` and SVG children.
2. Inspect text for Excalifont and an embedded font stylesheet.
3. Toggle Obsidian theme; screens should change immediately.
4. Embed blocks in a flow with `[[screens#^id|WxH]]`. Check first load,
   including the first render in a session when the screens note has never
   been opened (the cold embed timing risk); no blank, code-only, cropped
   or scaled images.
5. Zoom beyond 300%; text and strokes should remain sharp.
6. Check all four note/drawing theme combinations: embeds must follow the
   drawing theme and match its labels' font.
7. Edit a base screen and verify its variants update on note autosave.
   Then edit its variant; verify both embeds update. Double-click
   an embed and confirm that it opens the source block for editing.
8. Export the drawing as SVG in light and dark mode; check embedded screens.
9. Remove the frontmatter, reload, and check the expected border change.
10. Disable Excalidraw and reopen: expect the dependency error and source.
    Re-enable and reopen. Also check invalid syntax and unobtrusive warnings.
11. Check the developer console for Wiredown, ExcalidrawAutomate, createSVG
    or embed-loader errors, including during note close and plugin unload.

The 60 ms DOM heartbeat and API signature come from the checked prototype.
The snapshot window (250 ms plus 150 ms stillness, 2 s cap), font embedding,
startup readiness, theme filtering, re-entrancy during embeds and lifecycle
integration still need the manual checks above for this build. Slow exports
can exceed the cap. Unit tests use a fake exporter, not Obsidian.

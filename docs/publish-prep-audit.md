# Pre-publication export audit

Every original core index export, including the types star export, was
checked against package sources, tests, evals and generator scripts.
Types retained internally remain available in inferred declarations.

| Export | Disposition / consumers |
|---|---|
| FENCE_KEYWORD | kept: `packages/web/src/gitea.ts`, `packages/web/src/render.ts`, `packages/obsidian-plugin/src/main.ts` |
| extractSpec | deleted |
| fenceSpec | deleted |
| specAtLine | deleted |
| formatError | kept: `packages/obsidian-plugin/src/render.ts` |
| nearest | kept: `packages/cli/src/flow.ts`, `packages/cli/src/output.ts` |
| parse | kept: `packages/excalidraw/tests/node.test.ts`, `packages/excalidraw/tests/flow-overlays.test.ts`, `packages/excalidraw/tests/png.test.ts`, `packages/excalidraw/tests/elements.test.ts` |
| parseOptions | unexported (internal module) |
| CATALOG | kept: `scripts/skill.mjs` |
| COMMON_FLAGS | kept: `scripts/skill.mjs` |
| catalogEntry | unexported (internal module) |
| optionsOf | unexported (internal module) |
| CatalogEntry | unexported (internal module) |
| check | kept: `packages/obsidian-plugin/tests/render.test.ts`, `packages/obsidian-plugin/src/render.ts` |
| CheckResult | unexported (internal module) |
| extendsId | kept: `packages/obsidian-plugin/src/render.ts` |
| resolve | kept: `packages/excalidraw/tests/flow-overlays.test.ts` |
| serialize | deleted |
| Lookup | unexported (internal module) |
| ResolveOptions | unexported (internal module) |
| ASCENT | deleted |
| DESCENT | deleted |
| FONT_CSS | deleted |
| FONT_STACK | deleted |
| LINE_HEIGHT | deleted |
| tableMeasure | deleted |
| unmeasured | deleted |
| fontMeasurer | kept: `packages/excalidraw/tests/flow-connect.test.ts`, `packages/excalidraw/src/flow-edit.ts` |
| FontMetrics | unexported (internal module) |
| layout | unexported (internal module) |
| Box | kept: `packages/cli/src/render.ts`, `packages/excalidraw/src/flow-refresh.ts`, `packages/excalidraw/src/elements.ts` |
| LayoutResult | kept: `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/elements.ts` |
| LayoutEnv | unexported (internal module) |
| DARK_COLORS | deleted |
| DARK_INK | deleted |
| DEFAULT_THEME | kept: `packages/excalidraw/tests/flow-overlays.test.ts`, `packages/excalidraw/src/flow-edit.ts` |
| FONT_SIZE | kept: `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/elements.ts` |
| INK | kept: `packages/excalidraw/src/elements.ts` |
| LIGHT_INK | kept: `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/elements.ts` |
| ICON_NAMES | kept: `scripts/skill.mjs` |
| isIcon | unexported (internal module) |
| EXCALIFONT | kept: `packages/excalidraw/tests/flow-connect.test.ts`, `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/flow-edit.ts`, `packages/excalidraw/src/elements.ts` |
| layoutScreen | kept: `packages/cli/tests/flow-overlays.test.ts`, `packages/cli/src/flow.ts`, `packages/cli/src/render.ts`, `packages/web/src/render.ts`, `packages/excalidraw/tests/node.test.ts`, `packages/excalidraw/tests/flow-overlays.test.ts`, `packages/excalidraw/tests/png.test.ts`, `packages/excalidraw/tests/flow-render.test.ts`, `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/node.ts`, `packages/obsidian-plugin/tests/render.test.ts`, `packages/obsidian-plugin/src/render.ts` |
| LayoutScreenOptions | unexported (internal module) |
| parseScreens | kept: `packages/cli/tests/skill.test.ts`, `packages/evals/src/tasks.ts`, `packages/obsidian-plugin/tests/render.test.ts` |
| checkScreens | kept: `packages/cli/tests/flow-overlays.test.ts`, `packages/cli/tests/skill.test.ts`, `packages/cli/src/flow.ts`, `packages/cli/src/render.ts`, `packages/cli/src/check.ts`, `packages/evals/src/arms.ts`, `packages/web/src/render.ts`, `packages/excalidraw/tests/flow-render.test.ts`, `packages/obsidian-plugin/src/render.ts` |
| BlockCheck | unexported (internal module) |
| Screen | kept: `packages/obsidian-plugin/src/render.ts` |
| CheckedScreen | kept: `packages/cli/src/render.ts`, `packages/web/src/render.ts` |
| ScreenDiagnostic | kept: `packages/cli/src/check.ts`, `packages/cli/src/output.ts`, `packages/web/src/render.ts` |
| CheckScreensResult | kept: `packages/web/src/render.ts` |
| ComponentType | unexported (internal module) |
| DirectiveType | unexported (internal module) |
| NodeType | unexported (internal module) |
| SpecNode | kept: `packages/evals/src/arms.ts`, `packages/excalidraw/src/node.ts` |
| ParseError | unexported (internal module) |
| ParseResult | unexported (internal module) |
| Size | unexported (internal module) |
| Point | unexported (internal module) |
| RectOp | unexported (internal module) |
| LineOp | unexported (internal module) |
| TextOp | unexported (internal module) |
| EllipseOp | unexported (internal module) |
| DrawOp | kept: `packages/excalidraw/tests/elements.test.ts`, `packages/excalidraw/src/elements.ts` |
| TextStyle | unexported (internal module) |
| Style | unexported (internal module) |
| MeasureText | unexported (internal module) |
| Theme | unexported (internal module) |
| RectOptions | unexported (internal module) |
| TextOptions | unexported (internal module) |
| Slot | unexported (internal module) |
| DrawContext | unexported (internal module) |
| Component | unexported (internal module) |

`EXCALIFONT_FAMILY` is newly public and shared by layout and the adapter.

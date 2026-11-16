# @wiredown/excalidraw

Turns a screen laid out by `@wiredown/core` into plain Excalidraw element
JSON. It has no Excalidraw dependency and no DOM: Excalidraw draws the
elements later, in whichever host exports them, so strokes, the font and dark
mode are Excalidraw's own. Elements are always for the light theme.

```ts
import { layoutScreen, parse } from "@wiredown/core";
import { sceneOf, screenElements } from "@wiredown/excalidraw";

const layout = layoutScreen(parse("button: Save #save").tree);
const { elements, width, height, boxes } = screenElements(layout, { idPrefix: "save" });
const scene = sceneOf(elements);
```

- `width` and `height` are the exported image's size, padding included.
- `boxes` holds layout's box for each `#id`, moved into the image's
  coordinates, so flow overlays can be placed by scaling them.
- Ids and seeds are stable: the same screen gives the same elements.

SVG export through Excalidraw is not here yet.

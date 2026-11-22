// The real renderer bundle and Excalidraw's real exporter, under happy-dom.
// happy-dom has no canvas and no FontFace: both are stubbed with just what
// Excalidraw's SVG export touches. The font is served from dist/fonts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Renderer } from "../src/loader";

it("renders a block through the built renderer and Excalidraw", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    const context: Record<string | symbol, unknown> = {
      filter: "none",
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    return new Proxy(context, {
      get: (o, k) => (k in o ? o[k] : () => undefined),
      set: (o, k, v) => ((o[k] = v), true),
    }) as never;
  });
  vi.stubGlobal(
    "FontFace",
    class {
      status = "unloaded";
      constructor(
        public family: string,
        public source: string,
        descriptors: object = {},
      ) {
        Object.assign(this, descriptors);
      }
      load() {
        return Promise.resolve(this);
      }
    },
  );
  const fetch = vi.fn(async (url: string) => {
    const font = /\/(fonts\/Excalifont\/[^/]+\.woff2)$/.exec(String(url));
    if (!font) return new Response("", { status: 404 });
    return new Response(readFileSync(join(import.meta.dirname, "../dist", font[1]!)));
  });
  vi.stubGlobal("fetch", fetch);
  document.body.innerHTML = `<pre>text: Hello</pre>`;
  const element = document.querySelector("pre")!;
  const { render } = (await import("../dist/wiredown-renderer.js" as string)) as Renderer;
  await render({ blocks: [{ element, source: "text: Hello", id: "hello" }], theme: "light" });
  const svg = document.querySelector(".wiredown-block > svg.wiredown-svg")!;
  expect(svg.querySelector("text")!.textContent).toBe("Hello");
  expect(svg.innerHTML).toContain(
    "@font-face { font-family: Excalifont; src: url(data:font/woff2;base64,",
  );
  expect(document.querySelector("details.wiredown-source > pre")).toBe(element);
  expect(fetch.mock.calls.every(([url]) => String(url).includes("/dist/fonts/Excalifont/"))).toBe(
    true,
  );
}, 30_000);

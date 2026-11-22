import { afterEach, expect, it, vi } from "vitest";
import { LOAD_FAILED, rendererUrl, start } from "../src/loader";
import type { Renderer } from "../src/loader";

const block = (text: string) => `<pre><code class="language-wiredown">${text}</code></pre>`;
let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function run(load: (url: string) => Promise<Renderer>) {
  const spy = vi.fn(load);
  stop = start({ document, rendererUrl: "https://cdn.example/r.js", load: spy });
  return spy;
}
const renderer = (): Renderer => ({ render: vi.fn(async () => {}) });

it("never requests the renderer on a page without wireframes", async () => {
  document.body.innerHTML = `<pre><code class="language-js">x</code></pre><p>text</p>`;
  const appended = vi.spyOn(document.head, "append");
  const load = run(async () => renderer());
  document.body.append(document.createElement("p"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(load).not.toHaveBeenCalled();
  expect(appended).not.toHaveBeenCalled();
  expect(document.querySelector("script")).toBeNull();
});

it("requests the renderer once for several blocks, and for blocks added later", async () => {
  document.body.innerHTML = block("text: a") + block("text: b");
  const r = renderer();
  const load = run(async () => r);
  await vi.waitFor(() => expect(r.render).toHaveBeenCalledOnce());
  expect(load).toHaveBeenCalledExactlyOnceWith("https://cdn.example/r.js");
  expect(vi.mocked(r.render).mock.calls[0]![0].blocks.map((b) => b.source)).toEqual([
    "text: a",
    "text: b",
  ]);
  document.body.insertAdjacentHTML("beforeend", block("text: c"));
  await vi.waitFor(() => expect(r.render).toHaveBeenCalledTimes(2));
  expect(vi.mocked(r.render).mock.calls[1]![0].blocks.map((b) => b.source)).toEqual(["text: c"]);
  expect(load).toHaveBeenCalledOnce();
});

it("passes the loader tag's extra fonts to the renderer", async () => {
  document.body.innerHTML = block("text: a");
  const r = renderer();
  const load = async () => r;
  stop = start({
    document,
    rendererUrl: "https://cdn.example/r.js",
    load,
    fonts: "Virgil",
  });
  await vi.waitFor(() => expect(r.render).toHaveBeenCalledOnce());
  expect(vi.mocked(r.render).mock.calls[0]![1]).toBe("Virgil");
});

it("passes the page's theme to the renderer", async () => {
  document.documentElement.dataset.theme = "gitea-dark";
  document.body.innerHTML = block("text: a");
  const r = renderer();
  run(async () => r);
  await vi.waitFor(() => expect(r.render).toHaveBeenCalledOnce());
  expect(vi.mocked(r.render).mock.calls[0]![0].theme).toBe("dark");
  delete document.documentElement.dataset.theme;
});

it("loads the renderer next to the loader, so a pinned version gets its own", () => {
  expect(rendererUrl("https://git.example/assets/wiredown/0.1.0/wiredown.js?v=2")).toBe(
    "https://git.example/assets/wiredown/0.1.0/wiredown-renderer.js",
  );
  expect(rendererUrl("https://cdn.example/npm/@wiredown/web@0.1.0/dist/wiredown.js")).toBe(
    "https://cdn.example/npm/@wiredown/web@0.1.0/dist/wiredown-renderer.js",
  );
});

it("keeps the original content and adds a notice when the renderer fails to load", async () => {
  document.body.innerHTML = `<div id="a">${block("text: a")}</div>`;
  const before = document.querySelector("pre")!.outerHTML;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  run(() => Promise.reject(new Error("blocked")));
  await vi.waitFor(() => expect(document.querySelector(".wiredown-notice")).not.toBeNull());
  expect(document.querySelector("#a")!.innerHTML).toBe(
    `${before.replace("<pre>", '<pre data-wiredown="">')}<div class="wiredown-notice">${LOAD_FAILED}</div>`,
  );
  expect(warn).toHaveBeenCalledOnce();
});

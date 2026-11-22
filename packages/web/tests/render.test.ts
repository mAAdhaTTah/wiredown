import { checkScreens, layoutScreen } from "@wiredown/core";
import { addScreen, embedSize, newFlow, screenElements, serializeFlow } from "@wiredown/excalidraw";
import type { ExcalidrawElementJson } from "@wiredown/excalidraw";
import { afterEach, expect, it, vi } from "vitest";
import type { Block } from "../src/gitea";
import { fetchText, render, resolveBlocks } from "../src/render";
import type { ExportSvg } from "../src/render";

const SVG = "http://www.w3.org/2000/svg";
const fence = (s: string, id?: string) => `\`\`\`wiredown\n${s}\n\`\`\`\n${id ? `^${id}\n` : ""}`;
const base = "text: Hello #hello";
const variant = "extends: base\nreplace: hello\n  text: Changed";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A stand-in for Excalidraw's exporter: a stub SVG of a fixed size. */
function fakeExport(width = 100, height = 50) {
  return vi.fn<ExportSvg>(async () => {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("class", "excalidraw");
    return svg as SVGSVGElement;
  });
}

function blocks(...items: [string, string?][]): Block[] {
  return items.map(([source, id]) => {
    const element = document.createElement("pre");
    element.textContent = source;
    document.body.append(element);
    return { element, source, ...(id ? { id } : {}) };
  });
}

/** Same-origin fetches served from a map; anything else is a 404. */
function serve(files: Record<string, string>) {
  const fetch = vi.fn(async (url: string) =>
    url in files ? new Response(files[url]) : new Response("", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const texts = (exportSvg: ReturnType<typeof fakeExport>) =>
  JSON.stringify(exportSvg.mock.calls.map(([scene]) => scene.elements));

it("replaces a block with its drawing, keeping the source under it", async () => {
  const [block] = blocks([base, "base"]);
  const exportSvg = fakeExport();
  await render({ blocks: [block!], theme: "dark" }, exportSvg, document);
  const container = document.body.firstElementChild!;
  expect(container.className).toBe("wiredown-block");
  expect(container.querySelector(":scope > svg")!.getAttribute("class")).toBe("wiredown-svg");
  expect(container.querySelector("details.wiredown-source > summary")!.textContent).toBe("Source");
  expect(container.querySelector("details > pre")).toBe(block!.element);
  expect(exportSvg).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    theme: "dark",
    padding: 0,
  });
  expect(texts(exportSvg)).toContain("Hello");
  expect(document.getElementById("wiredown-style")).not.toBeNull();
});

it.each([true, false])(
  "resolves a variant against another block (base first: %s)",
  async (first) => {
    const items: [string, string][] = [
      [base, "base"],
      [variant, "variant"],
    ];
    const all = blocks(...(first ? items : items.reverse()));
    const exportSvg = fakeExport();
    await render({ blocks: all, theme: "light" }, exportSvg, document);
    expect(document.querySelectorAll(".wiredown-block > svg")).toHaveLength(2);
    expect(texts(exportSvg)).toContain("Changed");
  },
);

it("resolves variants against the page's Markdown file, with file lines", async () => {
  const note = `# Screens\n\n${fence(base, "base")}\n${fence("extends: base\nreplace: nope\n  text: x", "v")}`;
  serve({ "http://localhost:3000/raw/screens.md": note });
  // The page's ^id paragraphs were not recognised: only the file knows the ids.
  const all = blocks([base], ["extends: base\nreplace: nope\n  text: x"]);
  const exportSvg = fakeExport();
  await render(
    { blocks: all, theme: "light", noteUrl: "http://localhost:3000/raw/screens.md" },
    exportSvg,
    document,
  );
  expect(exportSvg).toHaveBeenCalledOnce();
  const error = document.querySelector(".wiredown-error")!.textContent!;
  expect(error).toMatch(/^line 10: /);
  // Without the file, ids come only from the page: lines are within the block.
  expect(resolveBlocks(all, undefined)[1]!.errors).toEqual([
    'line 1: extends: no screen with the id "base"',
  ]);
});

it("falls back to the page's blocks when a block is not in the file", async () => {
  serve({ "http://localhost:3000/raw/a.md": fence("text: other", "base") });
  const all = blocks([base, "base"], [variant, "variant"]);
  const exportSvg = fakeExport();
  await render(
    { blocks: all, theme: "light", noteUrl: "http://localhost:3000/raw/a.md" },
    exportSvg,
    document,
  );
  expect(texts(exportSvg)).toContain("Changed");
});

it("shows errors as line N: message with the source visible, and does not export", async () => {
  const [block] = blocks(["box\n  bogus: x"]);
  const exportSvg = fakeExport();
  await render({ blocks: [block!], theme: "light" }, exportSvg, document);
  const container = document.querySelector(".wiredown-block")!;
  expect(container.querySelector(".wiredown-error li")!.textContent).toMatch(/^line \d+: /);
  expect(container.querySelector(":scope > pre")).toBe(block!.element);
  expect(container.querySelector("details")).toBeNull();
  expect(exportSvg).not.toHaveBeenCalled();
});

it("shows warnings under the drawing", async () => {
  const [block] = blocks(["text: {warnin} ⋯"]);
  await render({ blocks: [block!], theme: "light" }, fakeExport(), document);
  const warnings = [...document.querySelectorAll(".wiredown-warning li")].map(
    (li) => li.textContent,
  );
  expect(warnings).toContain("line 1: screen has no ^id; it can't be embedded in a flow");
  expect(warnings.length).toBeGreaterThan(1);
  expect(document.querySelector(".wiredown-block > svg")).not.toBeNull();
});

it("contains an exporter failure: the block stays, with a notice and one warning", async () => {
  const [a, b] = blocks([base, "a"], ["text: two", "b"]);
  const html = a!.element.outerHTML;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const exportSvg = vi.fn<ExportSvg>(async () => {
    throw new Error("canvas exploded");
  });
  await expect(
    render({ blocks: [a!, b!], theme: "light" }, exportSvg, document),
  ).resolves.toBeUndefined();
  expect(a!.element.outerHTML).toBe(html);
  expect(a!.element.parentElement).toBe(document.body);
  expect(a!.element.nextElementSibling!.textContent).toBe(
    "Could not draw this wireframe: canvas exploded",
  );
  expect(warn).toHaveBeenCalledTimes(2);
});

it("only fetches from the page's own origin", async () => {
  const fetch = serve({});
  await expect(fetchText("https://evil.example/x.md", document)).rejects.toThrow(/another origin/);
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses to follow a redirect, which could leave the origin", async () => {
  const fetch = serve({});
  await fetchText(new URL("/x.md", document.URL).href, document);
  expect(fetch).toHaveBeenCalledWith(expect.any(String), {
    credentials: "same-origin",
    redirect: "error",
  });
});

// A flow with the screen "one" twice and a "missing" screen, as `wiredown flow` writes it.
function flowFile(
  embeds: [string, string][] = [
    ["one", "screens"],
    ["missing", "screens"],
    ["one", "screens"],
  ],
) {
  const flow = newFlow();
  for (const [id, path] of embeds)
    addScreen(flow, { screenId: id, title: id, path, size: { width: 100, height: 50 } });
  return serializeFlow(flow);
}
const FLOW_URL = "http://localhost:3000/me/app/raw/branch/main/flows/a.excalidraw.md";
const SCREENS_URL = "http://localhost:3000/me/app/raw/branch/main/screens.md";

function flowTarget() {
  const element = document.createElement("div");
  element.className = "file-view";
  element.textContent = "rendered markdown";
  document.body.append(element);
  return { element, url: FLOW_URL, root: "http://localhost:3000/me/app/raw/branch/main/" };
}

it("draws a flow above the page with each embedded screen as a padded SVG file", async () => {
  serve({ [FLOW_URL]: flowFile(), [SCREENS_URL]: fence("text: One", "one") });
  const target = flowTarget();
  const exportSvg = fakeExport(100, 50);
  await render({ blocks: [], flow: target, theme: "dark" }, exportSvg, document);
  // One export for "one" (light), one for the whole drawing (page theme).
  expect(exportSvg.mock.calls.map(([, o]) => o)).toEqual([
    { theme: "light", padding: 0 },
    { theme: "dark", padding: 16 },
  ]);
  const scene = exportSvg.mock.calls[1]![0];
  const images = scene.elements.filter((e: ExcalidrawElementJson) => e.type === "image");
  const files = Object.values(scene.files) as { dataURL: string; mimeType: string }[];
  expect(files).toHaveLength(2);
  const padded = embedSize(100, 50).image;
  for (const file of files) {
    expect(file.mimeType).toBe("image/svg+xml");
    const svg = atob(file.dataURL.replace("data:image/svg+xml;base64,", ""));
    expect(svg).toMatch(new RegExp(`^<svg [^>]*width="${padded.width}" height="${padded.height}"`));
    expect(svg).toContain('<svg x="10" y="0" ');
  }
  expect(images.filter((e: ExcalidrawElementJson) => String(e.fileId) in scene.files)).toHaveLength(
    2,
  );
  expect(images).toHaveLength(3);
  const drawn = target.element.closest(".wiredown-flow")!;
  expect(drawn.className).toBe("wiredown-block wiredown-flow");
  expect(drawn.querySelector("svg")).not.toBeNull();
  expect(drawn.querySelector(".wiredown-notice")!.textContent).toBe(
    "Not drawn:[[screens#^missing]]: no such screen",
  );
  expect(target.element.textContent).toBe("rendered markdown");
  const details = target.element.parentElement as HTMLDetailsElement;
  expect(details.className).toBe("wiredown-source");
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")!.textContent).toBe("Source");
});

it("finds each embed's screens file by the shared rule, fetching candidates in order", async () => {
  const root = "http://localhost:3000/me/app/raw/branch/main/";
  const fetch = serve({
    [FLOW_URL]: flowFile([
      ["one", "screens"],
      ["one", "ui"],
      ["one", "../other"],
      ["one", "gone"],
      ["one", "./gone"],
      ["one", "../../escape"],
      ["one", "a/../../escape"],
    ]),
    [SCREENS_URL]: fence("text: One", "one"),
    [root + "flows/ui.md"]: fence("text: Other", "one"),
    [root + "other.md"]: fence("text: Third", "one"),
  });
  const target = flowTarget();
  const exportSvg = fakeExport();
  await render({ blocks: [], flow: target, theme: "light" }, exportSvg, document);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    FLOW_URL,
    // the path from the repository's raw root first
    SCREENS_URL,
    // then as a trailing part of a path, from the flow's folder up
    root + "ui.md",
    root + "flows/ui.md",
    // ../ from the flow's folder, and nothing else
    root + "other.md",
    // not found: the walk stops at the repository's raw root
    root + "gone.md",
    root + "flows/gone.md",
    // ./gone is that file again, fetched once; a path that leaves the root is never fetched
  ]);
  // the same block id from several files: each drawn from its own file
  for (const text of ["One", "Other", "Third"]) expect(texts(exportSvg)).toContain(text);
  expect(Object.keys(exportSvg.mock.calls.at(-1)![0].files)).toHaveLength(3);
  expect(document.querySelector(".wiredown-flow .wiredown-notice")!.textContent).toBe(
    `Not drawn:[[gone#^one]]: no gone.md was found in ${root}` +
      `[[./gone#^one]]: no ./gone.md was found from ${root}flows/` +
      `[[../../escape#^one]]: it points outside ${root}` +
      `[[a/../../escape#^one]]: it points outside ${root}`,
  );
});

it("contains a flow that cannot be read", async () => {
  serve({ [FLOW_URL]: "not a drawing" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const target = flowTarget();
  await render({ blocks: [], flow: target, theme: "light" }, fakeExport(), document);
  expect(target.element.previousElementSibling!.className).toBe("wiredown-notice");
  expect(target.element.previousElementSibling!.textContent).toMatch(/^Could not draw this flow: /);
  expect(target.element.textContent).toBe("rendered markdown");
  expect(target.element.closest("details")).toBeNull();
  expect(warn).toHaveBeenCalledOnce();
});

it("reports rejected images and unshipped fonts before export", async () => {
  const flow = newFlow();
  flow.files.remote = { dataURL: "https://attacker.invalid/x" };
  flow.elements.push({ id: "note1234", type: "text", fontFamily: 100 });
  serve({ [FLOW_URL]: serializeFlow(flow) });
  const target = flowTarget();
  const exportSvg = fakeExport();
  await render({ blocks: [], flow: target, theme: "light" }, exportSvg, document);
  expect(document.querySelector(".wiredown-notice")!.textContent).toContain("image file remote:");
  expect(document.querySelector(".wiredown-notice")!.textContent).toContain(
    "text in font 100 is drawn in a fallback font",
  );
  expect(exportSvg.mock.calls[0][0].elements[0].fontFamily).toBe(5);
  expect(exportSvg.mock.calls[0][0].files).toEqual({});
});

it("draws Excalidraw's other fonts in Excalifont unless the site added them", async () => {
  const flow = newFlow();
  flow.elements.push(
    { id: "virgil01", type: "text", fontFamily: 1 },
    { id: "nunito01", type: "text", fontFamily: 6 },
    { id: "helvet01", type: "text", fontFamily: 2 },
  );
  serve({ [FLOW_URL]: serializeFlow(flow) });
  const notes = async (fonts?: string) => {
    document.body.innerHTML = "";
    const exportSvg = fakeExport();
    await render({ blocks: [], flow: flowTarget(), theme: "light" }, exportSvg, document, fonts);
    return {
      families: exportSvg.mock.calls[0][0].elements.map((e) => e.fontFamily),
      notice: document.querySelector(".wiredown-notice")?.textContent ?? "",
    };
  };
  const plain = await notes();
  expect(plain.families).toEqual([5, 5, 2]);
  expect(plain.notice).toContain("text in font 1 is drawn in a fallback font");
  expect(plain.notice).toContain("text in font 6 is drawn in a fallback font");
  const added = await notes(" Virgil, Nunito ");
  expect(added.families).toEqual([1, 6, 2]);
  expect(added.notice).not.toContain("fallback font");
});

it("says when a flow is out of date with its screens, and draws it as it was", async () => {
  const source = fence("text: One", "one");
  const size = screenElements(layoutScreen(checkScreens(source).screens[0]!.tree));
  const flow = newFlow();
  addScreen(flow, { screenId: "one", title: "one", path: "screens", size });
  const notice = async (screens: string) => {
    document.body.innerHTML = "";
    serve({ [FLOW_URL]: serializeFlow(flow), [SCREENS_URL]: screens });
    await render({ blocks: [], flow: flowTarget(), theme: "light" }, fakeExport(), document);
    expect(document.querySelector(".wiredown-flow svg")).not.toBeNull();
    return document.querySelector(".wiredown-notice")?.textContent;
  };
  expect(await notice(source)).toBeUndefined();
  expect(await notice(fence("text: One\ntext: Two", "one"))).toBe(
    "This flow is out of date with its screens; run wiredown flow refresh.",
  );
});

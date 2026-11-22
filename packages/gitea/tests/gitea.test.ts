import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { expect, it } from "vitest";
import { DONE, findBlocks, findFlow, noteUrl, rawRoot, rawUrl, theme } from "../src/gitea";

// The fixtures' structure is assumed from the prototypes, not captured from a live Gitea.
export function page(fixture: string, url: string, dark = false): Document {
  const window = new Window({ url });
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes("dark"),
  })) as unknown as typeof window.matchMedia;
  const html = readFileSync(join(import.meta.dirname, "fixtures/gitea", fixture), "utf8");
  window.document.write(html);
  return window.document as unknown as Document;
}

const FILE = "https://git.example/me/app/src/branch/main/docs/screens.md";
const FLOW = "https://git.example/me/app/src/branch/main/docs/flows/review.excalidraw.md";

it("finds wiredown blocks, their ^id paragraphs and the element to replace", () => {
  const document = page("file-view.html", FILE);
  const blocks = findBlocks(document);
  expect(blocks.map((b) => [b.element.tagName, b.element.className, b.id, b.source])).toEqual([
    ["DIV", "code-block-container", "base", "text: Hello #hello"],
    ["PRE", "", "variant", "extends: base\nreplace: hello\n  text: Changed"],
  ]);
  blocks[0]!.element.setAttribute(DONE, "");
  expect(findBlocks(document).map((b) => b.id)).toEqual(["variant"]);
});

it("finds blocks outside file views, without an id", () => {
  const document = page("comment.html", "https://git.example/me/app/pulls/3");
  expect(findBlocks(document)).toEqual([
    { element: document.querySelector("pre"), source: "text: In a comment" },
  ]);
  expect(noteUrl(document)).toBeUndefined();
  expect(findFlow(document)).toBeUndefined();
});

it("derives raw URLs from file view URLs, under a sub-path too", () => {
  expect(rawUrl(FILE)).toBe("https://git.example/me/app/raw/branch/main/docs/screens.md");
  expect(rawUrl("https://h.example/git/me/app/src/commit/abc123/a.md?display=source#L2")).toBe(
    "https://h.example/git/me/app/raw/commit/abc123/a.md",
  );
  expect(rawUrl("https://h.example/me/app/src/tag/v1/a.md")).toBe(
    "https://h.example/me/app/raw/tag/v1/a.md",
  );
  expect(rawUrl("https://h.example/me/app/issues/1")).toBeUndefined();
});

it("takes the raw root at the ref's first segment, the shortest plausible root", () => {
  expect(rawRoot("https://h.example/git/me/app/raw/branch/feature/x/docs/a.md")).toBe(
    "https://h.example/git/me/app/raw/branch/feature/",
  );
  expect(rawRoot("https://h.example/me/app/raw/commit/abc123/a.md")).toBe(
    "https://h.example/me/app/raw/commit/abc123/",
  );
  expect(rawRoot("https://h.example/me/app/src/branch/main/a.md")).toBeUndefined();
});

it("gives a Markdown file view's raw URL for variants", () => {
  expect(noteUrl(page("file-view.html", FILE))).toBe(
    "https://git.example/me/app/raw/branch/main/docs/screens.md",
  );
  expect(noteUrl(page("file-view.html", FILE.replace(".md", ".txt")))).toBeUndefined();
});

it("detects a flow page and its raw URL, once", () => {
  const document = page("flow-view.html", FLOW);
  const flow = findFlow(document)!;
  expect(flow.element.classList.contains("file-view")).toBe(true);
  expect(flow.url).toBe(
    "https://git.example/me/app/raw/branch/main/docs/flows/review.excalidraw.md",
  );
  expect(flow.root).toBe("https://git.example/me/app/raw/branch/main/");
  flow.element.setAttribute(DONE, "");
  expect(findFlow(document)).toBeUndefined();
  expect(findFlow(page("file-view.html", FILE))).toBeUndefined();
});

it("reads the theme from html[data-theme], following the OS for auto", () => {
  expect(theme(page("file-view.html", FILE))).toBe("dark");
  expect(theme(page("comment.html", FILE))).toBe("light");
  expect(theme(page("flow-view.html", FLOW))).toBe("light");
  expect(theme(page("flow-view.html", FLOW, true))).toBe("dark");
});

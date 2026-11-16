import { expect, test } from "vitest";
import { embedCandidates, embedNotFound, embedPathFor, resolveEmbedPath } from "../src/index.js";

const flow = "file:///work/specs/invites/flows/a.excalidraw.md";
const repo = { url: "file:///work/", vault: false };
const vault = { url: "file:///work/", vault: true };
const parent = { url: "file:///work/specs/invites/", vault: false };

test("a bare name: parent of the flow's folder, the folder, then up to the root", () => {
  expect(embedCandidates(flow, "screens", repo)).toEqual([
    "file:///work/specs/invites/screens.md",
    "file:///work/specs/invites/flows/screens.md",
    "file:///work/specs/screens.md",
    "file:///work/screens.md",
  ]);
  // neither a vault nor a repository: the parent of the flow's folder is the root
  expect(embedCandidates(flow, "screens", parent)).toEqual([
    "file:///work/specs/invites/screens.md",
    "file:///work/specs/invites/flows/screens.md",
  ]);
});

test("a path: from the vault root, else from each folder up to the root", () => {
  expect(embedCandidates(flow, "specs/invites/screens", vault)).toEqual([
    "file:///work/specs/invites/screens.md",
  ]);
  expect(embedCandidates(flow, "invites/my screens.md", repo)).toEqual([
    "file:///work/specs/invites/flows/invites/my%20screens.md",
    "file:///work/specs/invites/invites/my%20screens.md",
    "file:///work/specs/invites/my%20screens.md",
    "file:///work/invites/my%20screens.md",
  ]);
  const raw = "https://git.example/o/r/raw/branch/main/";
  expect(embedCandidates(raw + "f/a.excalidraw.md", "ui", { url: raw, vault: false })).toEqual([
    raw + "ui.md",
    raw + "f/ui.md",
  ]);
});

test.each(["../outside", "a/../../b", "/etc/screens", "C:/x", "https://evil.example/s", "..\\x"])(
  "a path that leaves the root has no candidates: %s",
  (path) => {
    for (const root of [repo, vault, parent])
      expect(embedCandidates(flow, path, root)).toBeUndefined();
  },
);

test("resolving takes the first candidate that exists, and says when a path leaves the root", async () => {
  const tried: string[] = [];
  const exists = async (url: string) => {
    tried.push(url);
    return (
      url.endsWith("/specs/screens.md") || url === "file:///work/specs/invites/flows/screens.md"
    );
  };
  expect(await resolveEmbedPath(flow, "screens", exists, repo)).toEqual({
    url: "file:///work/specs/invites/flows/screens.md",
  });
  expect(tried).toHaveLength(2);
  expect(await resolveEmbedPath(flow, "nope", async () => false, repo)).toBeUndefined();
  expect(await resolveEmbedPath(flow, "../outside", async () => true, vault)).toEqual({
    outside: true,
  });
});

test("the path to write, and why one did not resolve", () => {
  const screens = "file:///work/specs/my%20invites/screens.md";
  expect(embedPathFor(screens, vault)).toBe("specs/my invites/screens");
  expect(embedPathFor(screens, repo)).toBe("screens");
  expect(embedPathFor(screens, { url: "file:///elsewhere/", vault: true })).toBeUndefined();
  expect(embedNotFound("ui", "spec/flows")).toBe("no ui.md was found from spec/flows upward");
  expect(embedNotFound("a/ui", "spec/flows", "/vault")).toBe(
    "no a/ui.md was found in the vault at /vault",
  );
});

import { expect, test } from "vitest";
import { embedCandidates, embedNotFound, embedPathFor, resolveEmbedPath } from "../src/index.js";

const flow = "file:///work/specs/invites/flows/a.excalidraw.md";

test("a bare name: parent of the flow's folder, the folder, then further up", () => {
  expect(embedCandidates(flow, "screens")).toEqual([
    "file:///work/specs/invites/screens.md",
    "file:///work/specs/invites/flows/screens.md",
    "file:///work/specs/screens.md",
    "file:///work/screens.md",
    "file:///screens.md",
  ]);
  expect(embedCandidates(flow, "screens", "file:///work/specs/")).toEqual([
    "file:///work/specs/invites/screens.md",
    "file:///work/specs/invites/flows/screens.md",
    "file:///work/specs/screens.md",
  ]);
});

test("a path: from the vault root, else from each folder up", () => {
  expect(embedCandidates(flow, "specs/invites/screens", "file:///work/")).toEqual([
    "file:///work/specs/invites/screens.md",
  ]);
  expect(embedCandidates(flow, "invites/my screens.md")).toEqual([
    "file:///work/specs/invites/flows/invites/my%20screens.md",
    "file:///work/specs/invites/invites/my%20screens.md",
    "file:///work/specs/invites/my%20screens.md",
    "file:///work/invites/my%20screens.md",
    "file:///invites/my%20screens.md",
  ]);
  expect(
    embedCandidates("https://git.example/o/r/raw/branch/main/f/a.excalidraw.md", "ui"),
  ).toEqual([
    "https://git.example/o/r/raw/branch/main/ui.md",
    "https://git.example/o/r/raw/branch/main/f/ui.md",
    "https://git.example/o/r/raw/branch/ui.md",
    "https://git.example/o/r/raw/ui.md",
    "https://git.example/o/r/ui.md",
    "https://git.example/o/ui.md",
    "https://git.example/ui.md",
  ]);
});

test("resolving takes the first candidate that exists", async () => {
  const tried: string[] = [];
  const exists = async (url: string) => {
    tried.push(url);
    return (
      url.endsWith("/specs/screens.md") || url === "file:///work/specs/invites/flows/screens.md"
    );
  };
  expect(await resolveEmbedPath(flow, "screens", exists)).toBe(
    "file:///work/specs/invites/flows/screens.md",
  );
  expect(tried).toHaveLength(2);
  expect(await resolveEmbedPath(flow, "nope", async () => false)).toBeUndefined();
});

test("the path to write, and why one did not resolve", () => {
  const screens = "file:///work/specs/my%20invites/screens.md";
  expect(embedPathFor(screens, "file:///work/")).toBe("specs/my invites/screens");
  expect(embedPathFor(screens)).toBe("screens");
  expect(embedPathFor(screens, "file:///elsewhere/")).toBe("screens");
  expect(embedNotFound("ui", "spec/flows")).toBe("no ui.md was found from spec/flows upward");
  expect(embedNotFound("a/ui", "spec/flows", "/vault")).toBe(
    "no a/ui.md was found in the vault at /vault",
  );
});

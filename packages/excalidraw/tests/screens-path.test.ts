import { expect, test } from "vitest";
import { embedCandidates, embedNotFound, embedPathFor, resolveEmbedPath } from "../src/index.js";

const flow = "file:///work/specs/invites/flows/a.excalidraw.md";
const root = "file:///work/";

test("a path: from the root, then from the flow's folder and each one above, nearest first", () => {
  expect(embedCandidates(flow, "specs/invites/screens", root)).toEqual([
    "file:///work/specs/invites/screens.md",
    "file:///work/specs/invites/flows/specs/invites/screens.md",
    "file:///work/specs/invites/specs/invites/screens.md",
    "file:///work/specs/specs/invites/screens.md",
  ]);
  expect(embedCandidates(flow, "my screens.md", "file:///work/specs/invites/")).toEqual([
    "file:///work/specs/invites/my%20screens.md",
    "file:///work/specs/invites/flows/my%20screens.md",
  ]);
  const raw = "https://git.example/o/r/raw/branch/main/";
  expect(embedCandidates(raw + "f/a.excalidraw.md", "ui", raw)).toEqual([
    raw + "ui.md",
    raw + "f/ui.md",
  ]);
});

test("./ and ../ name one file from the flow's folder", () => {
  expect(embedCandidates(flow, "../screens", root)).toEqual([
    "file:///work/specs/invites/screens.md",
  ]);
  expect(embedCandidates(flow, "./ui.md", root)).toEqual([
    "file:///work/specs/invites/flows/ui.md",
  ]);
  expect(embedCandidates(flow, "../../../other/screens", root)).toEqual([
    "file:///work/other/screens.md",
  ]);
});

test.each([
  "../../../../outside",
  "a/../../b",
  "../screens",
  "/etc/screens",
  "C:/x",
  "https://evil.example/s",
  "..\\x",
])("a path that leaves the root has no candidates: %s", (path) => {
  expect(embedCandidates(flow, path, "file:///work/specs/invites/flows/")).toBeUndefined();
});

test("resolving takes the first candidate that exists, and says when a path leaves the root", async () => {
  const tried: string[] = [];
  const exists = async (url: string) => {
    tried.push(url);
    return url.endsWith("/specs/screens.md") || url === "file:///work/specs/invites/screens.md";
  };
  expect(await resolveEmbedPath(flow, "screens", exists, root)).toEqual({
    url: "file:///work/specs/invites/screens.md",
  });
  expect(tried).toEqual([
    "file:///work/screens.md",
    "file:///work/specs/invites/flows/screens.md",
    "file:///work/specs/invites/screens.md",
  ]);
  expect(await resolveEmbedPath(flow, "nope", async () => false, root)).toBeUndefined();
  expect(await resolveEmbedPath(flow, "/outside", async () => true, root)).toEqual({
    outside: true,
  });
});

test("the path to write, and why one did not resolve", () => {
  const screens = "file:///work/specs/my%20invites/screens.md";
  expect(embedPathFor(screens, root)).toBe("specs/my invites/screens");
  expect(embedPathFor(screens, "file:///work/specs/")).toBe("my invites/screens");
  expect(embedPathFor(screens, "file:///elsewhere/")).toBeUndefined();
  expect(embedNotFound("ui", "spec/flows", "/work")).toBe("no ui.md was found in /work");
  expect(embedNotFound("../ui", "spec/flows", "/work")).toBe(
    "no ../ui.md was found from spec/flows",
  );
});

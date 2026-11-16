// Finding the screens file an embed names, in Node, by @wiredown/excalidraw's
// rule (resolveEmbedPath), within the flow's root.
import { realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { embedNotFound, embedPathFor, resolveEmbedPath } from "@wiredown/excalidraw";
import type { EmbedRoot } from "@wiredown/excalidraw";

const dirUrl = (dir: string) => pathToFileURL(dir.endsWith(sep) ? dir : dir + sep).href;

/** The nearest directory at or above `dir` holding `name`, if any. */
async function nearest(dir: string, name: string, directory: boolean) {
  for (; ; dir = dirname(dir)) {
    const info = await stat(join(dir, name)).catch(() => undefined);
    if (info && (!directory || info.isDirectory())) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The root every embed search from `file` stays within: the nearest
 * directory at or above the flow holding `.obsidian/` (a vault), else the
 * nearest holding `.git` (a file or directory), else the parent of the
 * flow's directory.
 */
export async function embedRoot(file: string): Promise<EmbedRoot> {
  const dir = dirname(resolve(file));
  const vault = await nearest(dir, ".obsidian", true);
  if (vault) return { url: dirUrl(vault), vault: true };
  return { url: dirUrl((await nearest(dir, ".git", false)) ?? dirname(dir)), vault: false };
}

/** A root as a path for messages, without its trailing separator. */
const rootPath = (root: EmbedRoot) => fileURLToPath(root.url).replace(/(.)[\\/]$/, "$1");

/** Whether `path`, symlinks followed, is inside `root`. */
async function inside(path: string, root: EmbedRoot) {
  const [real, top] = await Promise.all([realpath(path), realpath(fileURLToPath(root.url))]);
  return real === top || real.startsWith(top.endsWith(sep) ? top : top + sep);
}

/**
 * The screens file `embedPath` names from `flowFile` (`{ path }`), or why
 * there is none, as it reads after `embeds [[…]]`: `but no ui.md was found
 * from <dir> upward`, or `which points outside <root>` for a path that
 * leaves the root, symlinks included.
 */
export async function resolveEmbed(
  flowFile: string,
  embedPath: string,
  root: EmbedRoot,
): Promise<{ path: string } | { why: string }> {
  const flowUrl = pathToFileURL(resolve(flowFile)).href;
  const isFile = (url: string) =>
    stat(fileURLToPath(url)).then(
      (s) => s.isFile(),
      () => false,
    );
  const found = await resolveEmbedPath(flowUrl, embedPath, isFile, root);
  const outside = { why: `which points outside ${rootPath(root)}` };
  if (!found)
    return {
      why: `but ${embedNotFound(embedPath, dirname(flowFile), root.vault ? rootPath(root) : undefined)}`,
    };
  if ("outside" in found) return outside;
  const path = fileURLToPath(found.url);
  return (await inside(path, root)) ? { path } : outside;
}

/**
 * The screens file a new frame embeds from (`--screens`, else `screens` by
 * the embed rule) and the embed path to write for it. Throws if the file is
 * outside the flow's root, or the path would lead a reader to another file.
 */
export async function screensToEmbed(flowFile: string, screens: string | undefined) {
  const root = await embedRoot(flowFile);
  let path = screens;
  if (path === undefined) {
    const found = await resolveEmbed(flowFile, "screens", root);
    if ("why" in found)
      throw new Error(found.why.replace(/^but /, "").replace(/^which /, "screens.md "));
    path = found.path;
  }
  await stat(path); // a missing --screens file is reported as such
  const embedPath = (await inside(path, root))
    ? embedPathFor(pathToFileURL(resolve(path)).href, root)
    : undefined;
  if (embedPath === undefined)
    throw new Error(`the screens file ${path} points outside ${rootPath(root)}`);
  const found = await resolveEmbed(flowFile, embedPath, root);
  if (!("path" in found) || found.path !== resolve(path))
    throw new Error(
      `the embed [[${embedPath}]] would lead from ${dirname(flowFile)} to ${"path" in found ? found.path : "no file"}, not ${path}; keep the screens file in or above the flow's directory, within ${rootPath(root)}`,
    );
  return { path, embedPath };
}

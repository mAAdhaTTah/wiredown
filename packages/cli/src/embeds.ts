// Finding the screens file an embed names, in Node, by @wiredown/excalidraw's
// rule (resolveEmbedPath).
import { stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { embedNotFound, embedPathFor, resolveEmbedPath } from "@wiredown/excalidraw";

/** The nearest directory at or above `file` holding `.obsidian/`, as a URL ending in `/`. */
export async function vaultRoot(file: string): Promise<string | undefined> {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    const info = await stat(join(dir, ".obsidian")).catch(() => undefined);
    if (info?.isDirectory()) return pathToFileURL(dir.endsWith(sep) ? dir : dir + sep).href;
    if (dirname(dir) === dir) return undefined;
  }
}

const isFile = (url: string) =>
  stat(fileURLToPath(url)).then(
    (s) => s.isFile(),
    () => false,
  );

/** The screens file `embedPath` names from `flowFile`, or undefined. */
export async function resolveEmbed(
  flowFile: string,
  embedPath: string,
  vault: string | undefined,
): Promise<string | undefined> {
  const url = await resolveEmbedPath(
    pathToFileURL(resolve(flowFile)).href,
    embedPath,
    isFile,
    vault,
  );
  return url && fileURLToPath(url);
}

/** Why `embedPath` does not resolve from `flowFile`. */
export function notFound(flowFile: string, embedPath: string, vault: string | undefined): string {
  return embedNotFound(embedPath, dirname(flowFile), vault && fileURLToPath(vault));
}

/**
 * The screens file a new frame embeds from (`--screens`, else `screens` by
 * the embed rule) and the embed path to write for it. Throws if that path
 * would lead a reader to another file.
 */
export async function screensToEmbed(flowFile: string, screens: string | undefined) {
  const vault = await vaultRoot(flowFile);
  const path = screens ?? (await resolveEmbed(flowFile, "screens", vault));
  if (!path) throw new Error(notFound(flowFile, "screens", vault));
  await stat(path); // a missing --screens file is reported as such
  const embedPath = embedPathFor(pathToFileURL(resolve(path)).href, vault);
  const found = await resolveEmbed(flowFile, embedPath, vault);
  if (found !== resolve(path))
    throw new Error(
      `the embed [[${embedPath}]] would lead from ${dirname(flowFile)} to ${found ?? "no file"}, not ${path}; keep the screens file in or above the flow's directory, or in an Obsidian vault`,
    );
  return { path, embedPath };
}

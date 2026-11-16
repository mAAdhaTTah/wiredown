// Which screens file an embed `[[path#^id]]` means. The CLI (Node) and
// @wiredown/web (the browser) share these pieces of the rule. Locations are
// URLs (`file:` in Node), so both runtimes resolve them the same way.
//
// Every search is bounded by a root, a directory URL ending in `/` that
// holds the flow: in Node the git repository's root, else the Obsidian
// vault's, else the folder above the nearest `flows/` folder, else the
// parent of the flow's directory; on a forge, the repository's raw-content
// root. Nothing outside the root is ever read.
//
// The path written is the screens file's path from the root. A reader takes
// `./x` and `../x` from the flow's directory; any other path names a file by
// its path from the root or, failing that, by a trailing part of it, as
// Obsidian links do (`screens`, `checkout/screens`).

/** Whether an embed path is relative to the flow's directory (`./x`, `../x`). */
export const isRelativeEmbed = (embedPath: string) => /^\.\.?\//.test(embedPath);

/**
 * The path to write in a new embed of `screensUrl`: its path from `root`,
 * without `.md`, such as `docs/checkout/screens`. Undefined if the file is
 * outside `root`.
 */
export function embedPathFor(screensUrl: string, root: string): string | undefined {
  if (!screensUrl.startsWith(root)) return undefined;
  return decodeURIComponent(screensUrl.slice(root.length)).replace(/\.md$/i, "");
}

/**
 * Where an embed's screens file may be, in the order a reader that cannot
 * list the root tries them, or undefined if the path points outside the
 * root (absolute, a `..` segment in a path not starting `./` or `../`, or
 * a candidate that normalises outside it):
 * - `./x` or `../x`: only that file, from the flow's directory;
 * - otherwise the path from the root, then the path from the flow's
 *   directory and from each one above it, nearest first.
 * The first candidate is the only one that is never a suffix match.
 */
export function embedCandidates(
  flowUrl: string,
  embedPath: string,
  root: string,
): string[] | undefined {
  const relative = isRelativeEmbed(embedPath);
  if (
    /^[\\/]|^[a-z][\w+.-]*:/i.test(embedPath) ||
    embedPath.includes("\\") ||
    (!relative && embedPath.split("/").includes(".."))
  )
    return undefined;
  const file =
    embedPath.split("/").map(encodeURIComponent).join("/") +
    (/\.md$/i.test(embedPath) ? "" : ".md");
  const flowDir = new URL(".", flowUrl).href;
  const dirs = relative ? [flowDir] : [root];
  if (!relative)
    for (let dir = flowDir; dir !== root && dir.startsWith(root); dir = new URL("..", dir).href)
      dirs.push(dir);
  const urls = dirs.map((dir) => new URL(file, dir).href);
  return urls.every((url) => url.startsWith(root)) ? urls : undefined;
}

/**
 * The first candidate that `exists` (`{ url }`), `{ outside: true }` if the
 * path points outside the root, or undefined. In the browser, `exists` is a
 * fetch.
 */
export async function resolveEmbedPath(
  flowUrl: string,
  embedPath: string,
  exists: (url: string) => Promise<boolean>,
  root: string,
): Promise<{ url: string } | { outside: true } | undefined> {
  const candidates = embedCandidates(flowUrl, embedPath, root);
  if (!candidates) return { outside: true };
  for (const url of candidates) if (await exists(url)) return { url };
  return undefined;
}

/**
 * Why an embed's path did not resolve: `no ../ui.md was found from <dir>`
 * for a relative path, else `no ui.md was found in <root>`.
 */
export function embedNotFound(embedPath: string, flowDir: string, root: string): string {
  const file = /\.md$/i.test(embedPath) ? embedPath : `${embedPath}.md`;
  return isRelativeEmbed(embedPath)
    ? `no ${file} was found from ${flowDir}`
    : `no ${file} was found in ${root}`;
}

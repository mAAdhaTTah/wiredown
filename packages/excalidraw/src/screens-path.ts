// Which screens file an embed `[[path#^id]]` means. Every reader (the CLI in
// Node, @wiredown/web in the browser) uses this one rule. Locations are URLs
// (`file:` in Node), so both runtimes resolve them the same way.
//
// Every search is bounded by a root, a directory URL ending in `/` that
// holds the flow: in Node the nearest directory at or above the flow holding
// `.obsidian/` (a vault), else the nearest holding `.git`, else the parent
// of the flow's directory; on a forge, the repository's raw-content root.
// Nothing outside the root is ever read.

/** The directory searches stop at; `vault` when it is an Obsidian vault's root. */
export interface EmbedRoot {
  url: string;
  vault: boolean;
}

/**
 * The path to write in a new embed of `screensUrl`, or undefined if the file
 * is outside `root`. Inside a vault it is the path from the vault root, which
 * Obsidian resolves unambiguously; otherwise the bare name, which readers
 * find by walking up from the flow. Either way without `.md`, with forward
 * slashes.
 *
 * To be confirmed by the owner: that Obsidian resolves a vault-root path such
 * as `[[specs/invites/screens#^id]]` to that file even when other files share
 * its name, and resolves a bare name to the nearest one.
 */
export function embedPathFor(screensUrl: string, root: EmbedRoot): string | undefined {
  if (!screensUrl.startsWith(root.url)) return undefined;
  const path = root.vault
    ? screensUrl.slice(root.url.length)
    : screensUrl.slice(screensUrl.lastIndexOf("/") + 1);
  return decodeURIComponent(path).replace(/\.md$/i, "");
}

/** The flow's directory and each one above it, nearest first, up to the root. */
function ancestors(flowUrl: string, root: EmbedRoot): string[] {
  const out: string[] = [];
  for (let dir = new URL(".", flowUrl).href; ;) {
    out.push(dir);
    const up = new URL("..", dir).href;
    if (dir === root.url || up === dir || !up.startsWith(root.url)) return out;
    dir = up;
  }
}

/**
 * Where an embed's screens file may be, in the order to try, or undefined
 * if the path points outside the root (absolute, a `..` segment, or a
 * candidate that normalises outside it):
 * - a path with a `/`: from the vault root in a vault, else from the flow's
 *   directory and each one above it up to the root, nearest first;
 * - a bare name: `<name>.md` in the parent of the flow's directory, then the
 *   flow's directory, then each directory further up to the root (the order
 *   flow commands have always searched, so `spec/flows/x` finds
 *   `spec/screens.md`).
 */
export function embedCandidates(
  flowUrl: string,
  embedPath: string,
  root: EmbedRoot,
): string[] | undefined {
  if (/^[\\/]|^[a-z][\w+.-]*:/i.test(embedPath) || embedPath.split(/[\\/]/).includes(".."))
    return undefined;
  const file =
    embedPath.split("/").map(encodeURIComponent).join("/") +
    (/\.md$/i.test(embedPath) ? "" : ".md");
  const dirs = ancestors(flowUrl, root);
  const order = embedPath.includes("/")
    ? root.vault
      ? [root.url]
      : dirs
    : dirs.length > 1
      ? [dirs[1], dirs[0], ...dirs.slice(2)]
      : dirs;
  const urls = order.map((dir) => new URL(file, dir).href);
  return urls.every((url) => url.startsWith(root.url)) ? urls : undefined;
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
  root: EmbedRoot,
): Promise<{ url: string } | { outside: true } | undefined> {
  const candidates = embedCandidates(flowUrl, embedPath, root);
  if (!candidates) return { outside: true };
  for (const url of candidates) if (await exists(url)) return { url };
  return undefined;
}

/** Why an embed's path did not resolve: `no ui.md was found from <dir> upward`. */
export function embedNotFound(embedPath: string, flowDir: string, vaultRoot?: string): string {
  const file = /\.md$/i.test(embedPath) ? embedPath : `${embedPath}.md`;
  return vaultRoot && embedPath.includes("/")
    ? `no ${file} was found in the vault at ${vaultRoot}`
    : `no ${file} was found from ${flowDir} upward`;
}

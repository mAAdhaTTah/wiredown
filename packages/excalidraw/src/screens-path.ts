// Which screens file an embed `[[path#^id]]` means. Every reader (the CLI in
// Node, @wiredown/web in the browser) uses this one rule. Locations are URLs
// (`file:` in Node), so both runtimes resolve them the same way.

/**
 * The path to write in a new embed of `screensUrl`. Inside an Obsidian vault
 * it is the path from the vault root, which Obsidian resolves unambiguously;
 * outside one it is the bare name, which readers find by walking up from the
 * flow. Either way without `.md`, with forward slashes.
 *
 * To be confirmed by the owner: that Obsidian resolves a vault-root path such
 * as `[[specs/invites/screens#^id]]` to that file even when other files share
 * its name, and resolves a bare name to the nearest one.
 */
export function embedPathFor(screensUrl: string, vaultRootUrl?: string): string {
  const path =
    vaultRootUrl && screensUrl.startsWith(vaultRootUrl)
      ? screensUrl.slice(vaultRootUrl.length)
      : screensUrl.slice(screensUrl.lastIndexOf("/") + 1);
  return decodeURIComponent(path).replace(/\.md$/i, "");
}

/** The flow's directory and each one above it, nearest first, up to the vault root or the top. */
function ancestors(flowUrl: string, vaultRootUrl?: string): string[] {
  const out: string[] = [];
  for (let dir = new URL(".", flowUrl).href; ;) {
    out.push(dir);
    const up = new URL("..", dir).href;
    if (dir === vaultRootUrl || up === dir) return out;
    dir = up;
  }
}

/**
 * Where an embed's screens file may be, in the order to try:
 * - a path with a `/`: from the vault root when one is known, else from the
 *   flow's directory and each one above it, nearest first;
 * - a bare name: `<name>.md` in the parent of the flow's directory, then the
 *   flow's directory, then each directory further up (the order flow
 *   commands have always searched, so `spec/flows/x` finds `spec/screens.md`).
 * The walk stops at the vault root or the top.
 */
export function embedCandidates(
  flowUrl: string,
  embedPath: string,
  vaultRootUrl?: string,
): string[] {
  const file =
    embedPath.split("/").map(encodeURIComponent).join("/") +
    (/\.md$/i.test(embedPath) ? "" : ".md");
  const dirs = ancestors(flowUrl, vaultRootUrl);
  const order = embedPath.includes("/")
    ? vaultRootUrl
      ? [vaultRootUrl]
      : dirs
    : dirs.length > 1
      ? [dirs[1], dirs[0], ...dirs.slice(2)]
      : dirs;
  return order.map((dir) => new URL(file, dir).href);
}

/** The first candidate that `exists`, or undefined. In the browser, `exists` is a fetch. */
export async function resolveEmbedPath(
  flowUrl: string,
  embedPath: string,
  exists: (url: string) => Promise<boolean>,
  vaultRootUrl?: string,
): Promise<string | undefined> {
  for (const url of embedCandidates(flowUrl, embedPath, vaultRootUrl))
    if (await exists(url)) return url;
  return undefined;
}

/** Why an embed's path did not resolve: `no ui.md was found from <dir> upward`. */
export function embedNotFound(embedPath: string, flowDir: string, vaultRoot?: string): string {
  const file = /\.md$/i.test(embedPath) ? embedPath : `${embedPath}.md`;
  return vaultRoot && embedPath.includes("/")
    ? `no ${file} was found in the vault at ${vaultRoot}`
    : `no ${file} was found from ${flowDir} upward`;
}

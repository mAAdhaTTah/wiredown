// Finding the screens file an embed names, in Node, by @wiredown/excalidraw's
// rule, within the flow's root. Unlike the browser, Node can list the root,
// so a path that is not found from the root is matched against the end of
// every Markdown file's path, and more than one match is an error.
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  embedCandidates,
  embedNotFound,
  embedPathFor,
  frameImage,
  isRelativeEmbed,
} from "@wiredown/excalidraw";
import type { Flow } from "@wiredown/excalidraw";

/**
 * The root every embed search from a flow stays within (`url`, a directory
 * URL), and the flow's URL beneath it: its symlinks followed when only that
 * path has a repository or vault above it.
 */
export interface EmbedRoot {
  url: string;
  flow: string;
  /** The root's `.md` files, listed on first use and kept for the command. */
  files?: Promise<string[]>;
}

const dirUrl = (dir: string) => pathToFileURL(dir.endsWith(sep) ? dir : dir + sep).href;

/** The nearest directory at or above `dir` holding `name`, if any. */
async function nearest(dir: string, name: string, directory: boolean) {
  for (; ; dir = dirname(dir)) {
    const info = await stat(join(dir, name)).catch(() => undefined);
    if (info && (!directory || info.isDirectory())) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The git repository's root above `dir` (`.git` a file or directory), else the vault's. */
async function repoOrVault(dir: string) {
  return (await nearest(dir, ".git", false)) ?? (await nearest(dir, ".obsidian", true));
}

/**
 * The root of embed searches from `file`: the git repository's root, else
 * the Obsidian vault's, each looked for above the flow's path and then above
 * its real path; else the parent of the flow's directory.
 */
export async function embedRoot(file: string): Promise<EmbedRoot> {
  const logical = resolve(file);
  const found = await repoOrVault(dirname(logical));
  if (found) return { url: dirUrl(found), flow: pathToFileURL(logical).href };
  // the flow file's real path, or its directory's for a flow not yet made
  const realFlow =
    (await realpath(logical).catch(() => undefined)) ??
    (await realpath(dirname(logical)).then(
      (dir) => join(dir, basename(logical)),
      () => undefined,
    ));
  const real = realFlow && (await repoOrVault(dirname(realFlow)));
  if (real) return { url: dirUrl(real), flow: pathToFileURL(realFlow).href };
  return { url: dirUrl(dirname(dirname(logical))), flow: pathToFileURL(logical).href };
}

/**
 * A path found from the flow, as output prints it: relative to the working
 * directory when the flow's path was given relative, else absolute.
 */
const shown = (flowFile: string, path: string) =>
  isAbsolute(flowFile) ? path : relative(process.cwd(), path) || ".";

/** A root as a path for messages, without its trailing separator. */
const rootPath = (root: EmbedRoot, flowFile: string) =>
  shown(flowFile, fileURLToPath(root.url).replace(/(.)[\\/]$/, "$1"));

/** Whether `path`, symlinks followed, is inside `root`. */
async function inside(path: string, root: EmbedRoot) {
  const [real, top] = await Promise.all([realpath(path), realpath(fileURLToPath(root.url))]);
  return real === top || real.startsWith(top.endsWith(sep) ? top : top + sep);
}

const isFile = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

/** Each `.md` file under `dir`, as a `/`-separated path from it, skipping dot folders and node_modules. */
async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  // a folder that cannot be read holds no file a reader could use
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      for (const path of await markdownFiles(join(dir, entry.name)))
        out.push(`${entry.name}/${path}`);
    } else if (/\.md$/i.test(entry.name)) out.push(entry.name);
  }
  return out;
}

/** Which screens file an embed names, or why there is none. */
export type EmbedResolution =
  | { ok: true; path: string; embedPath: string }
  | { ok: false; reason: "missing" | "ambiguous" | "outside"; message: string };

/**
 * The screens file `embedPath` names from the flow (`{ ok: true, path, embedPath }`,
 * with the path to write for it now), or why there is none: `missing`
 * (`no ui.md was found in <root>`), `ambiguous` when several files end with
 * the path (`ui matches several files: <a>, <b>; …`), or `outside` for a
 * path that leaves the root, symlinks included (`ui points outside <root>`).
 */
export async function resolveEmbed(
  flowFile: string,
  embedPath: string,
  root: EmbedRoot,
): Promise<EmbedResolution> {
  const outside = {
    ok: false,
    reason: "outside",
    message: `${embedPath} points outside ${rootPath(root, flowFile)}`,
  } as const;
  const candidates = embedCandidates(root.flow, embedPath, root.url);
  if (!candidates) return outside;
  let url: string | undefined = candidates[0];
  if (!(await isFile(fileURLToPath(url)))) {
    url = undefined;
    if (!isRelativeEmbed(embedPath)) {
      const link = embedPath.replace(/\.md$/i, "");
      root.files ??= markdownFiles(fileURLToPath(root.url));
      const matches = (await root.files)
        .filter((path) => {
          const name = path.replace(/\.md$/i, "");
          return name === link || name.endsWith("/" + link);
        })
        .sort();
      if (matches.length > 1)
        return {
          ok: false,
          reason: "ambiguous",
          message: `${embedPath} matches several files: ${matches.join(", ")}; name one by its path from ${rootPath(root, flowFile)}`,
        };
      if (matches.length)
        url = new URL(matches[0].split("/").map(encodeURIComponent).join("/"), root.url).href;
    }
  }
  if (!url)
    return {
      ok: false,
      reason: "missing",
      message: embedNotFound(embedPath, dirname(flowFile), rootPath(root, flowFile)),
    };
  const path = fileURLToPath(url);
  return (await inside(path, root))
    ? { ok: true, path: shown(flowFile, path), embedPath: embedPathFor(url, root.url)! }
    : outside;
}

/**
 * The screens file a new frame embeds from (`--screens`, any `.md` file in
 * the flow's root) and the embed path to write for it, its path from the
 * root. Throws if the file is outside the root.
 */
export async function screensToEmbed(flowFile: string, path: string) {
  const root = await embedRoot(flowFile);
  await fileOp(`cannot read the screens file ${path}`, stat(path));
  if (!/\.md$/i.test(path)) throw new CommandError(`the screens file ${path} is not a .md file`);
  let url = pathToFileURL(resolve(path)).href;
  if (!url.startsWith(root.url)) url = pathToFileURL(await realpath(path)).href;
  if (!url.startsWith(root.url) || !(await inside(path, root)))
    throw new CommandError(`the screens file ${path} points outside ${rootPath(root, flowFile)}`);
  const embedPath = embedPathFor(url, root.url)!;
  // parseEmbed ends the path at # or |, and the link at ]
  if (/[#|\]]/.test(embedPath))
    throw new CommandError(
      `${path}: a screens file's path cannot contain #, | or ], which end the path in an embed link`,
    );
  return { path, embedPath };
}

/**
 * The screens file and block id a frame's image embeds, resolved from the
 * flow. Throws, naming the frame, when there is no such file.
 */
export async function frameEmbed(flowFile: string, flow: Flow, frame: string) {
  const embed = flow.embeds.get(String(frameImage(flow, frame).fileId));
  if (!embed?.blockId) throw new Error(`${frame}'s image does not embed a screen block`);
  const found = await resolveEmbed(flowFile, embed.path, await embedRoot(flowFile));
  if ("why" in found)
    throw new Error(`${frame} embeds [[${embed.path}#^${embed.blockId}]], ${found.why}`);
  return { path: found.path, blockId: embed.blockId };
}

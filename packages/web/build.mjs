// Builds the two browser files and the font Excalidraw inlines into exports.
// - dist/wiredown.js: the loader, an IIFE so it works as a classic
//   <script src defer> (which gives it document.currentScript, its own URL).
// - dist/wiredown-renderer.js: ESM with code splitting, as the prototype
//   built it, so Excalidraw's on-demand chunks (locales, font subsetting)
//   stay out of the first download; they land in dist/chunks/.
import { build } from "esbuild";
import { cp, readFile, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const started = Date.now();
await rm("dist", { recursive: true, force: true });
const common = {
  bundle: true,
  minify: true,
  platform: "browser",
  target: "es2020",
  logLevel: "warning",
  // keep the licence banners of bundled code (React's requires it)
  legalComments: "eof",
};
await build({
  ...common,
  entryPoints: ["src/wiredown.ts"],
  format: "iife",
  outfile: "dist/wiredown.js",
});

// Excalidraw falls back to esm.sh for a font it cannot load from
// EXCALIDRAW_ASSET_PATH. Point the fallback at the same path, so the
// renderer never fetches from another origin.
const FALLBACK =
  '`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`';
const sameOriginFonts = {
  name: "same-origin-fonts",
  setup(b) {
    let replaced = 0;
    b.onLoad(
      { filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/ },
      async (args) => {
        const text = await readFile(args.path, "utf8");
        const out = text.replaceAll(
          FALLBACK,
          () => (replaced++, "String(globalThis.EXCALIDRAW_ASSET_PATH)"),
        );
        return { contents: out, loader: "js" };
      },
    );
    b.onEnd(() => {
      if (replaced !== 1)
        throw new Error(`expected one esm.sh font fallback, replaced ${replaced}`);
    });
  },
};
const { metafile } = await build({
  ...common,
  metafile: true,
  entryPoints: ["src/wiredown-renderer.ts"],
  format: "esm",
  splitting: true,
  outdir: "dist",
  chunkNames: "chunks/[name]-[hash]",
  conditions: ["production"],
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".ttf": "file", ".css": "empty" },
  plugins: [sameOriginFonts],
});

// Only Excalifont, with its licence; a site adds other families itself
// (README, "Other fonts").
await cp(
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont",
  "dist/fonts/Excalifont",
  {
    recursive: true,
  },
);
await cp("OFL.txt", "dist/fonts/Excalifont/OFL.txt");

// Notices for what the renderer bundles; see THIRD-PARTY-NOTICES.md.
await cp("THIRD-PARTY-NOTICES.md", "dist/THIRD-PARTY-NOTICES.md");
for (const name of ["react", "react-dom"])
  await cp(`node_modules/${name}/LICENSE`, `dist/licenses/${name}.txt`);

const size = async (files) => {
  const bytes = await Promise.all([...files].map((f) => readFile(f)));
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  return `${kb(bytes.reduce((a, b) => a + b.length, 0))} min, ${kb(bytes.reduce((a, b) => a + gzipSync(b).length, 0))} gzip`;
};
console.log(`dist/wiredown.js: ${await size(["dist/wiredown.js"])}`);
console.log(`dist/wiredown-renderer.js: ${await size(["dist/wiredown-renderer.js"])}`);
const chunks = Object.keys(metafile.outputs).filter((f) => f.endsWith(".js"));
console.log(`renderer and all its chunks (${chunks.length} files): ${await size(chunks)}`);
console.log(`@wiredown/web built in ${Date.now() - started} ms`);

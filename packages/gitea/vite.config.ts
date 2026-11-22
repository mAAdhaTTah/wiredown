// Builds dist/ as a Gitea custom directory: copying dist/* into
// $GITEA_CUSTOM installs it. The files are under ASSETS, a folder named for
// the version, which Gitea serves at /assets/wiredown/<version>/.
// - templates/custom/footer.tmpl: the tag that loads the loader on every page.
// - ASSETS/wiredown.js: the loader, an IIFE so it works as a classic
//   <script src defer> (which gives it document.currentScript, its own URL).
// - ASSETS/wiredown-renderer.js: ESM with code splitting, so Excalidraw's
//   on-demand chunks (locales, font subsetting) stay out of the first
//   download; they land in ASSETS/chunks/.
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import type { Rolldown } from "vite";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const ASSETS = `public/assets/wiredown/${version}`;
// AppSubUrl is Gitea's base path, empty unless Gitea is served under one.
const FOOTER = `<script src="{{AppSubUrl}}/assets/wiredown/${version}/wiredown.js" defer></script>\n`;

// Excalidraw falls back to esm.sh for a font it cannot load from
// EXCALIDRAW_ASSET_PATH. Point the fallback at the same path, so the
// renderer never fetches from another origin.
const FALLBACK =
  '`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`';
function sameOriginFonts(): Rolldown.Plugin {
  let replaced = 0;
  return {
    name: "same-origin-fonts",
    transform(code, id) {
      if (!/@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/.test(id)) return;
      return code.replaceAll(
        FALLBACK,
        () => (replaced++, "String(globalThis.EXCALIDRAW_ASSET_PATH)"),
      );
    },
    buildEnd() {
      if (replaced !== 1)
        throw new Error(`expected one esm.sh font fallback, replaced ${replaced}`);
    },
  };
}

// Writes files into dist: { "path in dist": contents }.
function emit(files: Record<string, string | Buffer>): Rolldown.Plugin {
  return {
    name: "emit",
    generateBundle() {
      for (const [fileName, source] of Object.entries(files))
        this.emitFile({ type: "asset", fileName, source });
    },
  };
}

const EXCALIFONT = "node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont";
// Files copied next to the bundle: { "path under ASSETS": "source path" }.
const copied = {
  // Only Excalifont, with its licence; a site adds other families itself
  // (README, "Other fonts").
  ...Object.fromEntries(
    readdirSync(EXCALIFONT).map((f) => [`fonts/Excalifont/${f}`, `${EXCALIFONT}/${f}`]),
  ),
  "fonts/Excalifont/OFL.txt": "OFL.txt",
  // Notices for what the renderer bundles; see THIRD-PARTY-NOTICES.md.
  "THIRD-PARTY-NOTICES.md": "THIRD-PARTY-NOTICES.md",
  "licenses/react.txt": "node_modules/react/LICENSE",
  "licenses/react-dom.txt": "node_modules/react-dom/LICENSE",
};
const files = {
  ...Object.fromEntries(
    Object.entries(copied).map(([to, from]) => [`${ASSETS}/${to}`, readFileSync(from)]),
  ),
  "templates/custom/footer.tmpl": FOOTER,
};

export default defineConfig({
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { target: "es2020", minify: true },
  // build both environments; the renderer first, as it empties dist/
  builder: {},
  environments: {
    client: {
      build: {
        lib: {
          entry: "src/wiredown-renderer.ts",
          fileName: () => `${ASSETS}/wiredown-renderer.js`,
          formats: ["es"],
        },
        rolldownOptions: {
          plugins: [sameOriginFonts(), emit(files)],
          checks: { moduleLevelDirective: false },
          // Excalidraw's font-subsetting worker imports its chunks in a fresh
          // scope; don't merge what it shares into Excalidraw's main chunk
          experimental: { chunkOptimization: false },
          // lib mode would keep the whitespace of an ES build
          output: {
            chunkFileNames: `${ASSETS}/chunks/[name]-[hash].js`,
            minify: true,
            comments: { legal: true },
          },
        },
      },
    },
    loader: {
      consumer: "client",
      build: {
        emptyOutDir: false,
        // name is required for an IIFE; the loader exports nothing, so no global
        lib: {
          entry: "src/wiredown.ts",
          name: "wiredown",
          fileName: () => `${ASSETS}/wiredown.js`,
          formats: ["iife"],
        },
        rolldownOptions: { output: { strict: true } },
      },
    },
  },
});

// dist/main.js: one CommonJS file, as Obsidian loads plugins, with Obsidian's
// own API left to require("obsidian"); manifest.json and styles.css beside it.
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    target: "es2020",
    minify: true,
    reportCompressedSize: false,
    lib: { entry: "src/main.ts", fileName: () => "main.js", formats: ["cjs"] },
    rolldownOptions: {
      external: ["obsidian"],
      // exports.default is the plugin class, and strict mode as ESM had it
      output: { exports: "named", strict: true },
      plugins: [
        {
          name: "install-files",
          generateBundle() {
            for (const fileName of ["manifest.json", "styles.css"])
              this.emitFile({ type: "asset", fileName, source: readFileSync(fileName) });
          },
        },
      ],
    },
  },
});

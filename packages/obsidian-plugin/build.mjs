import { copyFile } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  external: ["obsidian"],
  minify: true,
  outfile: "dist/main.js",
  logLevel: "info",
});
for (const file of ["manifest.json", "styles.css"]) await copyFile(file, `dist/${file}`);

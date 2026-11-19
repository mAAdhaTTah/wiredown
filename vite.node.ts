import { globSync } from "node:fs";
import { dts } from "rolldown-plugin-dts";
import { defineConfig } from "vite";

/**
 * The build of a Node library package (core, excalidraw, cli): each module
 * in src/ becomes dist/<name>.js and dist/<name>.d.ts, the layout tsc
 * emitted. Packages and Node built-ins stay imports; nothing is bundled.
 */
export function nodeLibrary() {
  return defineConfig({
    // declarations, with the ".js" specifiers Node's resolution needs
    plugins: [dts()],
    // keep Vite's Oxc transform off those declarations (and off .js, its default)
    oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
    build: {
      ssr: true,
      target: "es2022",
      minify: false,
      rolldownOptions: {
        input: globSync("src/**/*.ts"),
        external: (id) => !/^[./\0]/.test(id),
        output: { preserveModules: true, preserveModulesRoot: "src", entryFileNames: "[name].js" },
      },
    },
  });
}

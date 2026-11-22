import { defaultClientConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // workspace packages from their source, not their dist/
  resolve: {
    conditions: ["@wiredown/source", ...defaultClientConditions],
    alias: { obsidian: new URL("./tests/obsidian.ts", import.meta.url).pathname },
  },
  test: { name: "obsidian", environment: "happy-dom", include: ["tests/**/*.test.ts"] },
});

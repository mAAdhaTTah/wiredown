import { defineProject } from "vitest/config";

export default defineProject({
  resolve: { alias: { obsidian: new URL("./tests/obsidian.ts", import.meta.url).pathname } },
  test: { name: "obsidian-plugin", environment: "happy-dom", include: ["tests/**/*.test.ts"] },
});

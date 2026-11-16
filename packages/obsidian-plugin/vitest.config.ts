import { defineProject } from "vitest/config";
export default defineProject({
  test: { name: "obsidian-plugin", environment: "happy-dom", include: ["tests/**/*.test.ts"] },
});

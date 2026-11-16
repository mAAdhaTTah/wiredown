import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "excalidraw",
    include: ["tests/**/*.test.ts"],
  },
});

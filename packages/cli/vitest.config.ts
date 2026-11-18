import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "cli",
    include: ["tests/**/*.test.ts"],
    // rendering starts headless Excalidraw, slow on a cold or busy machine
    testTimeout: 30_000,
  },
});

import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // workspace packages from their source, not their dist/
  ssr: { resolve: { conditions: ["@wiredown/source", ...defaultServerConditions] } },
  test: {
    name: "excalidraw",
    include: ["tests/**/*.test.ts"],
    // headless Excalidraw export is slow on a cold or busy machine
    testTimeout: 30_000,
  },
});

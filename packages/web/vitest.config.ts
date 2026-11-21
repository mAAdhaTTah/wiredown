import { defaultClientConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // workspace packages from their source, not their dist/
  resolve: { conditions: ["@wiredown/source", ...defaultClientConditions] },
  test: { name: "web", environment: "happy-dom", include: ["tests/**/*.test.ts"] },
});

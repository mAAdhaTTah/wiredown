import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// `pnpm test:gitea` only: the root config's projects never load this file,
// and tests/gitea/*.gitea.ts match no project's include. Starting Gitea and
// drawing in a real browser take longer than a unit test.
export default defineConfig({
  ssr: { resolve: { conditions: ["@wiredown/source", ...defaultServerConditions] } },
  test: {
    root: import.meta.dirname,
    include: ["tests/gitea/**/*.gitea.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});

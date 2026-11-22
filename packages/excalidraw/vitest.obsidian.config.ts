import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// `pnpm test:obsidian` only: the root config's projects never load this file,
// and tests/obsidian/*.obsidian.ts match no project's include. Downloading and
// starting Obsidian takes longer than a unit test.
export default defineConfig({
  ssr: { resolve: { conditions: ["@wiredown/source", ...defaultServerConditions] } },
  test: {
    root: import.meta.dirname,
    include: ["tests/obsidian/**/*.obsidian.ts"],
    // One Obsidian at a time: files run in parallel would download and unpack
    // it into the same cache at once on a first run.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});

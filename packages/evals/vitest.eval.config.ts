import { defineConfig } from "vitest/config";
import { readConfig } from "./src/config.ts";

const config = readConfig();
// a run is up to 1 + cap model calls, one after another
const perRun = config.timeoutMs * (config.cap + 1) + 60_000;

// `pnpm eval` only. The root config's projects never load this file, and
// evals/*.eval.ts match no project's include.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["evals/**/*.eval.ts"],
    reporters: ["vitest-evals/reporter"],
    sequence: { concurrent: true },
    maxConcurrency: config.concurrency,
    testTimeout: perRun,
    hookTimeout: 120_000,
  },
});

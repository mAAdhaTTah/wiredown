import { join } from "node:path";
import { defineConfig } from "vitest/config";
import { readConfig } from "./src/config";

const config = readConfig();
// a run is up to 1 + cap model calls, one after another
const perRun = config.timeoutMs * (config.cap + 1) + 60_000;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// `pnpm eval` only. The root config's projects never load this file, and
// evals/*.eval.ts match no project's include. The JSON report keeps every
// case's measures, scores, final file, prompts, replies and usage; the
// README says how to browse it.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["evals/**/*.eval.ts"],
    reporters: ["vitest-evals/reporter", "json"],
    outputFile: { json: join(config.resultsDir, stamp, "results.json") },
    sequence: { concurrent: true },
    maxConcurrency: config.concurrency,
    testTimeout: perRun,
    hookTimeout: 120_000,
  },
});

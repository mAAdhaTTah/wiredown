import { defineProject } from "vitest/config";

// The unit tests of the eval code; they run in `pnpm test` and never call a
// model. The evals themselves (evals/*.eval.ts) only run through
// vitest.eval.config.ts (`pnpm eval`).
export default defineProject({
  test: {
    name: "evals",
    include: ["tests/**/*.test.ts"],
  },
});

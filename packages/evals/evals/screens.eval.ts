// How well a model writes wiredown screens from the skill's syntax
// reference: three authoring tasks, with a fix loop on `check` errors. Run
// with `pnpm eval`; never part of `pnpm test` or CI. See ../README.md.
import { beforeAll, expect } from "vitest";
import { createHarness, createJudge, describeEval } from "vitest-evals";
import type { JudgeContext } from "vitest-evals";
import { checkFile } from "../src/check";
import { runClaude } from "../src/claude";
import { readConfig } from "../src/config";
import { runTask } from "../src/loop";
import { loadMaterial } from "../src/material";
import { TASKS } from "../src/tasks";
import type { TaskId } from "../src/tasks";

const config = readConfig();
const material = loadMaterial(config.material);

const runner = (prompt: string) =>
  runClaude(prompt, { model: config.model, timeoutMs: config.timeoutMs });

beforeAll(async () => {
  // the inputs of tasks 2 and 3 must check clean
  for (const [name, file] of Object.entries({
    "variant-base.md": material.variantBase,
    "review.md": material.reviewInput,
  })) {
    const { errors } = checkFile(file);
    if (errors.length) {
      throw new Error(`${name} in ${material.dir} does not check clean: ${errors[0].message}`);
    }
  }
  // fail fast, with claude's own message, when the CLI can't run here
  try {
    await runClaude("Reply with the single word: ok", { model: config.model, timeoutMs: 60_000 });
  } catch (error) {
    throw new Error(`claude -p does not work here: ${(error as Error).message}`);
  }
}, 120_000);

interface CaseInput {
  task: TaskId;
  run: number;
}

/** The run's measures and its final file; prompts and replies go in the events. */
type CaseOutput = {
  firstAttemptErrors: number | null;
  fixRounds: number | null;
  cap: number;
  attempts: number;
  lines: number | null;
  diffSize: number | null;
  structureOk: boolean;
  structureReason: string | null;
  wallMs: number;
  /** The checked screens file; null when no reply was well-formed. */
  file: string | null;
};

const harness = createHarness<CaseInput, CaseOutput>({
  name: `claude -p --model ${config.model}`,
  run: async ({ input }) => {
    const task = TASKS.find((t) => t.id === input.task)!;
    const result = await runTask({ task, material, runner, cap: config.cap, run: input.run });
    return {
      output: {
        firstAttemptErrors: result.firstAttemptErrors,
        fixRounds: result.fixRounds,
        cap: config.cap,
        attempts: result.attempts.length,
        lines: result.lines,
        diffSize: result.diffSize,
        structureOk: result.structureOk,
        structureReason: result.structureReason ?? null,
        wallMs: result.wallMs,
        file: result.output === null ? null : task.assemble(result.input, result.output),
      },
      events: result.attempts.flatMap((a) => [
        { type: "message" as const, role: "user" as const, content: a.prompt },
        {
          type: "message" as const,
          role: "assistant" as const,
          content: a.reply ?? `(failed: ${a.failure})`,
        },
      ]),
      usage: {
        provider: "anthropic",
        model: config.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      },
      timings: { totalMs: result.wallMs },
    };
  },
});

type Ctx = JudgeContext<CaseInput, CaseOutput>;

// Scores are measures, not pass/fail: judgeThreshold is null below.
const judges = [
  // 1 when clean on the first attempt, 1/2 after one fix round, and so on;
  // 0 when not clean within the cap
  createJudge<Ctx>("FixEfficiency", ({ output }) => ({
    score: output.fixRounds === null ? 0 : 1 / (1 + output.fixRounds),
    metadata: {
      rationale:
        output.fixRounds === null
          ? `not clean after ${output.cap} fix round(s); ` +
            `first-attempt errors: ${output.firstAttemptErrors ?? "no file"}`
          : `clean after ${output.fixRounds} fix round(s)`,
    },
  })),
  // structural only (ids kept, a variant of the base): it does not judge
  // whether the requested change was made
  createJudge<Ctx>("StructureOk", ({ output }) => ({
    score: output.structureOk ? 1 : 0,
    metadata: {
      rationale: output.structureReason ?? "structure as required",
      lines: output.lines,
      diffSize: output.diffSize,
      wallMs: output.wallMs,
    },
  })),
];

const runs = Array.from({ length: config.runs }, (_, i) => ({ n: i + 1 }));

for (const task of TASKS) {
  describeEval(
    `task ${task.number}: ${task.title}`,
    { harness, judges, judgeThreshold: null },
    (it) => {
      it.for(runs)("run $n", async ({ n }, { run }) => {
        const result = await run({ task: task.id, run: n });
        expect(result.output.attempts).toBeGreaterThan(0);
      });
    },
  );
}

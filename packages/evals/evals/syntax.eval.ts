// The syntax eval of the proposal's "How to test it": the fork before the
// proposal ("old") against the fork after it ("new"), three authoring tasks,
// a fix loop on `check` errors. Run with `pnpm eval`; never part of
// `pnpm test` or CI. See ../README.md.
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import { createHarness, createJudge, describeEval } from "vitest-evals";
import type { JudgeContext } from "vitest-evals";
import { ARMS, loadArms } from "../src/arms.ts";
import type { Arm, ArmName } from "../src/arms.ts";
import { BASELINE_SHA } from "../src/baseline.ts";
import { runClaude } from "../src/claude.ts";
import { readConfig } from "../src/config.ts";
import { runTask } from "../src/loop.ts";
import type { TaskRun } from "../src/loop.ts";
import { loadMaterial } from "../src/material.ts";
import { ratingCases, summarize, writeResults } from "../src/results.ts";
import { TASKS } from "../src/tasks.ts";
import type { TaskId } from "../src/tasks.ts";

const config = readConfig();
const material = loadMaterial(config.material);
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = join(config.resultsDir, stamp);
const runs: TaskRun[] = [];
let arms: Record<ArmName, Arm>;

const runner = (prompt: string) =>
  runClaude(prompt, { model: config.model, timeoutMs: config.timeoutMs });

beforeAll(async () => {
  arms = await loadArms();
  // the inputs of tasks 2 and 3 must be clean in their own syntax
  for (const arm of ARMS) {
    for (const [name, file] of Object.entries(material.inputs[arm])) {
      const { errors } = arms[arm].check(file);
      if (errors.length) {
        throw new Error(
          `${arm}/${name} in ${material.dir} does not check clean: ${errors[0].message}`,
        );
      }
    }
  }
  // fail fast, with claude's own message, when the CLI can't run here
  try {
    await runClaude("Reply with the single word: ok", { model: config.model, timeoutMs: 60_000 });
  } catch (error) {
    throw new Error(`claude -p does not work here: ${(error as Error).message}`);
  }
}, 120_000);

afterAll(() => {
  if (!runs.length) return;
  const requests: Record<TaskId, string> = {
    screens: material.screens.map((s) => `^${s.id}`).join(", "),
    variant: `a variant ^${material.variant.id} of ^${material.variant.base}: ${material.variant.change}`,
    review: `reviewer comment on ^${material.review.screen}: "${material.review.comment}"`,
  };
  const order = (r: TaskRun) => TASKS.findIndex((t) => t.id === r.task);
  const sorted = [...runs].sort(
    (a, b) => order(a) - order(b) || a.arm.localeCompare(b.arm) || a.run - b.run,
  );
  const summary = writeResults(
    outDir,
    {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      config,
      materialDir: material.dir,
      prdPath: material.prdPath,
      baselineSha: BASELINE_SHA,
      summary: summarize(sorted),
      runs: sorted,
    },
    ratingCases(runs, requests),
    config.seed ?? stamp,
  );
  console.log(`\n${summary}\nResults: ${outDir}\n`);
});

interface CaseInput {
  task: TaskId;
  arm: ArmName;
  run: number;
}

/** The run as JSON for the reporter; the full record goes to results.json. */
type CaseOutput = {
  firstAttemptErrors: number | null;
  firstClean: boolean;
  fixRounds: number | null;
  cap: number;
  attempts: number;
  lines: number | null;
  diffSize: number | null;
  structureOk: boolean;
  structureReason: string | null;
  wallMs: number;
};

const harness = createHarness<CaseInput, CaseOutput>({
  name: `claude -p --model ${config.model}`,
  run: async ({ input }) => {
    const task = TASKS.find((t) => t.id === input.task)!;
    const result = await runTask({
      task,
      arm: arms[input.arm],
      material,
      runner,
      cap: config.cap,
      run: input.run,
    });
    runs.push(result);
    return {
      output: {
        firstAttemptErrors: result.firstAttemptErrors,
        firstClean: result.firstClean,
        fixRounds: result.fixRounds,
        cap: config.cap,
        attempts: result.attempts.length,
        lines: result.lines,
        diffSize: result.diffSize,
        structureOk: result.structureOk,
        structureReason: result.structureReason ?? null,
        wallMs: result.wallMs,
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
  createJudge<Ctx>("CleanFirstAttempt", ({ output }) => ({
    score: output.firstClean ? 1 : 0,
    metadata: { rationale: `first-attempt errors: ${output.firstAttemptErrors ?? "no file"}` },
  })),
  createJudge<Ctx>("CleanWithinCap", ({ output }) => ({
    score: output.fixRounds === null ? 0 : 1,
    metadata: {
      rationale:
        output.fixRounds === null
          ? `not clean after ${output.cap} fix round(s)`
          : `clean after ${output.fixRounds} fix round(s)`,
    },
  })),
  // 1 when clean on the first attempt, 1/2 after one fix round, and so on
  createJudge<Ctx>("FixEfficiency", ({ output }) => ({
    score: output.fixRounds === null ? 0 : 1 / (1 + output.fixRounds),
  })),
  // structural only (ids kept, a variant of the base): it does not judge
  // whether the requested change was made; the rating sheet is for that
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

const cases = ARMS.flatMap((arm) =>
  Array.from({ length: config.runs }, (_, i) => ({ arm, run: i + 1 })),
);

for (const task of TASKS) {
  describeEval(
    `task ${task.number}: ${task.title}`,
    { harness, judges, judgeThreshold: null },
    (it) => {
      it.for(cases)("$arm, run $run", async ({ arm, run: n }, { run }) => {
        const result = await run({ task: task.id, arm, run: n });
        expect(result.output.attempts).toBeGreaterThan(0);
      });
    },
  );
}

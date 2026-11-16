import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARMS } from "./arms.ts";
import type { ArmName } from "./arms.ts";
import type { EvalConfig } from "./config.ts";
import type { TaskRun } from "./loop.ts";
import { ratingSheet } from "./rate.ts";
import type { RatingCase } from "./rate.ts";
import type { TaskId } from "./tasks.ts";
import { TASKS } from "./tasks.ts";

export interface SummaryRow {
  task: TaskId | "all";
  arm: ArmName;
  runs: number;
  /** Share of runs whose first attempt checked clean. */
  firstClean: number;
  /** Mean errors on well-formed first attempts; null when there were none. */
  firstAttemptErrors: number | null;
  /** Share of runs that reached a clean check within the cap. */
  reachedClean: number;
  /** Mean fix rounds of the runs that reached clean. */
  fixRounds: number | null;
  /** Share of runs whose output passed the structural check. */
  structureOk: number;
  lines: number | null;
  diffSize: number | null;
  wallS: number;
  costUsd: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const present = (xs: (number | null | undefined)[]) =>
  xs.filter((x): x is number => x !== null && x !== undefined);

function row(task: SummaryRow["task"], arm: ArmName, runs: TaskRun[]): SummaryRow {
  const costs = present(runs.map((r) => r.costUsd));
  return {
    task,
    arm,
    runs: runs.length,
    firstClean: mean(runs.map((r) => (r.firstClean ? 1 : 0))) ?? 0,
    firstAttemptErrors: mean(present(runs.map((r) => r.firstAttemptErrors))),
    reachedClean: mean(runs.map((r) => (r.fixRounds !== null ? 1 : 0))) ?? 0,
    fixRounds: mean(present(runs.map((r) => r.fixRounds))),
    structureOk: mean(runs.map((r) => (r.structureOk ? 1 : 0))) ?? 0,
    lines: mean(present(runs.map((r) => r.lines))),
    diffSize: mean(present(runs.map((r) => r.diffSize))),
    wallS: (mean(runs.map((r) => r.wallMs)) ?? 0) / 1000,
    costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
}

/** Means per task and arm, then per arm over all tasks. */
export function summarize(runs: TaskRun[]): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const task of TASKS) {
    for (const arm of ARMS) {
      const these = runs.filter((r) => r.task === task.id && r.arm === arm);
      if (these.length) rows.push(row(task.id, arm, these));
    }
  }
  for (const arm of ARMS) {
    const these = runs.filter((r) => r.arm === arm);
    if (these.length) rows.push(row("all", arm, these));
  }
  return rows;
}

const num = (x: number | null, digits = 1) => (x === null ? "–" : x.toFixed(digits));
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function summaryTable(rows: SummaryRow[]): string {
  const head =
    "| Task | Arm | Runs | Clean 1st | 1st-attempt errors | Reached clean | Fix rounds | " +
    "Structure OK | Lines | Diff size | Wall s | Cost $ |";
  const lines = [head, "|" + " --- |".repeat(12)];
  for (const r of rows) {
    lines.push(
      `| ${r.task} | ${r.arm} | ${r.runs} | ${pct(r.firstClean)} | ${num(r.firstAttemptErrors)} | ` +
        `${pct(r.reachedClean)} | ${num(r.fixRounds)} | ${pct(r.structureOk)} | ${num(r.lines)} | ` +
        `${num(r.diffSize)} | ${num(r.wallS)} | ${num(r.costUsd, 4)} |`,
    );
  }
  return lines.join("\n") + "\n";
}

export interface Results {
  startedAt: string;
  finishedAt: string;
  config: EvalConfig;
  materialDir: string;
  prdPath: string;
  baselineSha: string;
  summary: SummaryRow[];
  runs: TaskRun[];
}

function summaryMarkdown(results: Results): string {
  const c = results.config;
  return [
    "# Wiredown syntax eval",
    "",
    `Model \`${c.model}\`, ${c.runs} run(s) per task and arm, fix-loop cap ${c.cap}.`,
    `PRD: \`${results.prdPath}\`. Baseline: \`${results.baselineSha}\`.`,
    `Started ${results.startedAt}, finished ${results.finishedAt}.`,
    "",
    "Columns: share of runs clean on the first attempt; mean `check` errors on",
    "well-formed first attempts; share that reached a clean check within the",
    "cap; mean fix rounds of those; share whose output passed the structural",
    "check (required ids kept, a variant of the base; not whether the change",
    "was made correctly, which only the rating sheet judges); mean non-blank",
    "lines of the output; mean added + removed non-blank lines against the",
    "input; mean wall time per run; total cost.",
    "",
    summaryTable(results.summary),
  ].join("\n");
}

/** The rating cases: tasks 2 and 3, one per run that both arms produced. */
export function ratingCases(runs: TaskRun[], requests: Record<TaskId, string>): RatingCase[] {
  const cases: RatingCase[] = [];
  for (const task of TASKS.filter((t) => t.id !== "screens")) {
    const numbers = [...new Set(runs.filter((r) => r.task === task.id).map((r) => r.run))].sort(
      (a, b) => a - b,
    );
    for (const n of numbers) {
      const of = (arm: ArmName) =>
        runs.find((r) => r.task === task.id && r.arm === arm && r.run === n);
      const old = of("old");
      const neu = of("new");
      if (!old || !neu) continue;
      const shown = (r: TaskRun) => ({
        input: r.input ?? "",
        file: r.output === null ? null : task.assemble(r.input, r.output),
      });
      cases.push({
        title: `task ${task.number} (${task.title}), run ${n}`,
        request: requests[task.id],
        outputs: { old: shown(old), new: shown(neu) },
      });
    }
  }
  return cases;
}

/** Write results.json, summary.md, rate.md and key.json; returns summary.md's text. */
export function writeResults(dir: string, results: Results, cases: RatingCase[], seed: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2) + "\n");
  const summary = summaryMarkdown(results);
  writeFileSync(join(dir, "summary.md"), summary);
  const { sheet, key } = ratingSheet(cases, seed);
  writeFileSync(join(dir, "rate.md"), sheet);
  writeFileSync(join(dir, "key.json"), JSON.stringify(key, null, 2) + "\n");
  return summary;
}

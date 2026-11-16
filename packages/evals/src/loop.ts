import type { Arm, ArmName } from "./arms.ts";
import { formatFindings } from "./arms.ts";
import type { ClaudeReply } from "./claude.ts";
import { diffSize, lineCount } from "./diff.ts";
import { extractFile } from "./extract.ts";
import type { Material } from "./material.ts";
import type { Task, TaskId } from "./tasks.ts";

/** One model call; throws (e.g. a ClaudeError) when the call fails. */
export type Runner = (prompt: string) => Promise<ClaudeReply>;

export interface Attempt {
  prompt: string;
  /** The raw reply; absent when the call failed. */
  reply?: string;
  /** Why the call failed or the reply was malformed. */
  failure?: string;
  /** Check errors in the assembled file; absent when there was no well-formed file. */
  errors?: number;
  warnings?: number;
  /** The errors as sent back to the model. */
  findings?: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
}

export interface TaskRun {
  task: TaskId;
  arm: ArmName;
  run: number;
  attempts: Attempt[];
  /** Check errors on the first attempt; null when it gave no well-formed file. */
  firstAttemptErrors: number | null;
  firstClean: boolean;
  /** Fix rounds to a clean check (0 when the first was clean); null when the cap was reached. */
  fixRounds: number | null;
  input: string | null;
  /** The last well-formed output, clean or not. */
  output: string | null;
  /** Non-blank lines of the output. */
  lines: number | null;
  /** Added plus removed non-blank lines of the checked file against the input. */
  diffSize: number | null;
  complete: boolean;
  completeReason?: string;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Summed over the attempts; absent when no call reported a cost. */
  costUsd?: number;
}

export interface LoopOptions {
  task: Task;
  arm: Arm;
  material: Material;
  runner: Runner;
  /** Fix rounds after the first attempt. */
  cap: number;
  run: number;
}

const fixPrompt = (original: string, previous: string, findings: string, note?: string) =>
  [
    original,
    "",
    "## Your previous reply",
    "",
    "````markdown",
    previous.trimEnd(),
    "````",
    "",
    "## `wiredown check screens.md` reported",
    "",
    "```text",
    findings.trimEnd(),
    "```",
    ...(note ? ["", note] : []),
    "",
    "Fix every error and reply again with the corrected file, in the reply format above.",
  ].join("\n");

const formatPrompt = (original: string, reason: string) =>
  [
    original,
    "",
    `Your previous reply could not be used: ${reason}. Reply again, in the reply format above.`,
  ].join("\n");

/** Run one task: an attempt, then fix rounds with the check's errors until clean or the cap. */
export async function runTask({ task, arm, material, runner, cap, run }: LoopOptions) {
  const started = Date.now();
  const input = task.input(material, arm);
  const original = task.prompt(material, arm);
  const attempts: Attempt[] = [];
  let prompt = original;
  let output: string | null = null;
  let fixRounds: number | null = null;
  for (let round = 0; round <= cap; round++) {
    const t0 = Date.now();
    const attempt: Attempt = { prompt, ms: 0 };
    attempts.push(attempt);
    let reply: ClaudeReply;
    try {
      reply = await runner(prompt);
    } catch (error) {
      attempt.failure = (error as Error).message;
      attempt.ms = Date.now() - t0;
      continue; // the same prompt again
    }
    attempt.ms = Date.now() - t0;
    attempt.reply = reply.text;
    if (reply.usage) {
      attempt.inputTokens = reply.usage.inputTokens;
      attempt.outputTokens = reply.usage.outputTokens;
      if (reply.usage.costUsd !== undefined) attempt.costUsd = reply.usage.costUsd;
      if (reply.usage.model) attempt.model = reply.usage.model;
    }
    const extracted = extractFile(reply.text);
    if (!extracted.ok) {
      attempt.failure = `malformed reply: ${extracted.reason}`;
      prompt = formatPrompt(original, extracted.reason);
      continue;
    }
    output = extracted.content;
    const report = arm.check(task.assemble(input, output));
    attempt.errors = report.errors.length;
    attempt.warnings = report.warnings.length;
    if (!report.errors.length) {
      fixRounds = round;
      break;
    }
    attempt.findings = formatFindings("screens.md", { ...report, warnings: [] });
    prompt = fixPrompt(original, output, attempt.findings, task.lineNote?.(input));
  }
  const file = output === null ? null : task.assemble(input, output);
  const completion =
    output === null || file === null
      ? { complete: false, reason: "no well-formed reply" }
      : task.complete(material, input, output, arm.check(file));
  const costs = attempts.map((a) => a.costUsd).filter((c) => c !== undefined);
  const result: TaskRun = {
    task: task.id,
    arm: arm.name,
    run,
    attempts,
    firstAttemptErrors: attempts[0].errors ?? null,
    firstClean: attempts[0].errors === 0,
    fixRounds,
    input,
    output,
    lines: output === null ? null : lineCount(output),
    diffSize: input === null || file === null ? null : diffSize(input, file),
    complete: completion.complete,
    ...(completion.reason ? { completeReason: completion.reason } : {}),
    wallMs: Date.now() - started,
    inputTokens: attempts.reduce((n, a) => n + (a.inputTokens ?? 0), 0),
    outputTokens: attempts.reduce((n, a) => n + (a.outputTokens ?? 0), 0),
    ...(costs.length ? { costUsd: costs.reduce((a, b) => a + b, 0) } : {}),
  };
  return result;
}

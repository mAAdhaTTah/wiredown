import { describe, expect, it } from "vitest";
import { newArm } from "../src/arms.ts";
import type { ClaudeReply } from "../src/claude.ts";
import { ClaudeError } from "../src/claude.ts";
import { runTask } from "../src/loop.ts";
import type { Runner } from "../src/loop.ts";
import { loadMaterial } from "../src/material.ts";
import { TASKS } from "../src/tasks.ts";

const material = loadMaterial();
const arm = newArm();
const task = (id: string) => TASKS.find((t) => t.id === id)!;
const wrap = (file: string) => "````markdown\n" + file + "\n````";

/** Replies in order, recording the prompts it was given. */
function fake(replies: (string | Error)[]): Runner & { prompts: string[] } {
  const prompts: string[] = [];
  const runner = async (prompt: string): Promise<ClaudeReply> => {
    prompts.push(prompt);
    const next = replies.shift();
    if (next === undefined) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return { text: next, usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 } };
  };
  return Object.assign(runner, { prompts });
}

const VARIANT = (body: string) =>
  [
    "## Paused",
    "",
    "```wiredown",
    "extends: exports-list",
    body,
    "```",
    "",
    "^exports-paused",
  ].join("\n");
const CLEAN = VARIANT("replace: usage\n  text: 3 of 5 scheduled exports used (2 active)");
const BROKEN = VARIANT("text: 3 of 5 scheduled exports used (2 active) #usage");

describe("runTask", () => {
  it("stops after a clean first attempt", async () => {
    const runner = fake([wrap(CLEAN)]);
    const r = await runTask({ task: task("variant"), arm, material, runner, cap: 3, run: 1 });
    expect(r).toMatchObject({
      firstAttemptErrors: 0,
      firstClean: true,
      fixRounds: 0,
      complete: true,
      lines: 7,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.01,
    });
    expect(r.attempts).toHaveLength(1);
    expect(r.diffSize).toBe(7);
    expect(runner.prompts[0]).toContain(arm.reference.slice(0, 200));
    expect(runner.prompts[0]).toContain("^exports-paused");
  });

  it("sends the errors back as check prints them and counts the fix round", async () => {
    const runner = fake([wrap(BROKEN), wrap(CLEAN)]);
    const r = await runTask({ task: task("variant"), arm, material, runner, cap: 3, run: 1 });
    expect(r).toMatchObject({ firstAttemptErrors: 1, firstClean: false, fixRounds: 1 });
    expect(r.attempts[0].findings).toMatch(
      /^screens\.md:\d+: \^exports-paused: error: in a variant, say what this does/,
    );
    expect(runner.prompts[1]).toContain(r.attempts[0].findings);
    expect(runner.prompts[1]).toContain("## Your previous reply");
    expect(runner.prompts[1]).toContain("with your screen appended from line");
    expect(r.output).toBe(CLEAN + "\n");
  });

  it("counts a malformed reply as a failed attempt and asks again", async () => {
    const runner = fake(["Sure! " + wrap(CLEAN), wrap(CLEAN)]);
    const r = await runTask({ task: task("variant"), arm, material, runner, cap: 3, run: 1 });
    expect(r).toMatchObject({ firstAttemptErrors: null, firstClean: false, fixRounds: 1 });
    expect(r.attempts[0].failure).toBe(
      "malformed reply: the reply does not start with a fence of four backticks",
    );
    expect(runner.prompts[1]).toContain("Your previous reply could not be used");
  });

  it("retries the same prompt after a failed call", async () => {
    const runner = fake([new ClaudeError("claude -p timed out after 1000 ms"), wrap(CLEAN)]);
    const r = await runTask({ task: task("variant"), arm, material, runner, cap: 1, run: 1 });
    expect(r.attempts[0].failure).toBe("claude -p timed out after 1000 ms");
    expect(runner.prompts[1]).toBe(runner.prompts[0]);
    expect(r.fixRounds).toBe(1);
  });

  it("gives up at the cap and keeps the last well-formed output", async () => {
    const runner = fake([wrap(BROKEN), wrap(BROKEN), "nope"]);
    const r = await runTask({ task: task("variant"), arm, material, runner, cap: 2, run: 1 });
    expect(r.attempts).toHaveLength(3);
    expect(r).toMatchObject({ fixRounds: null, firstAttemptErrors: 1, output: BROKEN + "\n" });
  });

  it("measures task 3's diff against its input and checks compliance", async () => {
    const input = material.inputs.new.review;
    const revised = input.replace(
      "Daily 06:00 | PDF | 2 people | Today 06:00 | {dot} Failed",
      "Daily 06:00 | PDF | 2 people | Today 06:00 | {warning} Failed",
    );
    const r = await runTask({
      task: task("review"),
      arm,
      material,
      runner: fake([wrap(revised)]),
      cap: 0,
      run: 1,
    });
    expect(r).toMatchObject({ fixRounds: 0, diffSize: 2, complete: true });
    const same = await runTask({
      task: task("review"),
      arm,
      material,
      runner: fake([wrap(input)]),
      cap: 0,
      run: 1,
    });
    expect(same).toMatchObject({ complete: false, completeReason: "the file is unchanged" });
  });

  it("reports missing screens in task 1", async () => {
    const file = ["## Empty", "", "```wiredown", "text: Nothing yet", "```", "", "^exports-empty"];
    const r = await runTask({
      task: task("screens"),
      arm,
      material,
      runner: fake([wrap(file.join("\n"))]),
      cap: 0,
      run: 1,
    });
    expect(r).toMatchObject({ firstClean: true, complete: false, diffSize: null, input: null });
    expect(r.completeReason).toBe(
      "missing screens: ^exports-list, ^export-new, ^export-detail, ^export-failed",
    );
  });
});

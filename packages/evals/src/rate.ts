import type { ArmName } from "./arms.ts";
import { unifiedDiff } from "./diff.ts";

/** One pair to rate: both arms' outputs for the same task and run. */
export interface RatingCase {
  title: string;
  /** What the model was asked to change. */
  request: string;
  outputs: Record<ArmName, { input: string; file: string | null }>;
}

export interface RatingKey {
  seed: string;
  cases: { case: number; title: string; A: ArmName; B: ArmName }[];
}

/** A small seeded PRNG (mulberry32 over an FNV-1a hash of the seed). */
export function seeded(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const answerLine = (n: number) => `Case ${n}, more readable (A / B / same):`;

function shown(output: { input: string; file: string | null }): string {
  if (output.file === null) return "_(no usable output)_";
  const diff = unifiedDiff(output.input, output.file, { from: "before", to: "after" });
  // longer than any backtick run in the diff, whose files hold ``` fences
  const longest = Math.max(0, ...(diff.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence + "diff", diff.trimEnd() || "(no change)", fence].join("\n");
}

/** The sheet the rater fills in, and the key that says which arm is A. */
export function ratingSheet(cases: RatingCase[], seed: string): { sheet: string; key: RatingKey } {
  const random = seeded(seed);
  const key: RatingKey = { seed, cases: [] };
  const parts = [
    "# Blind readability rating",
    "",
    "For each case, two outputs of the same task are shown as diffs against",
    "their input. Which one reads better to a reviewer? Write A, B or same",
    "after each answer line. Do not open key.json until you are done; then run",
    "`pnpm eval:reveal <this directory>`.",
  ];
  cases.forEach((c, i) => {
    const n = i + 1;
    const [A, B]: ArmName[] = random() < 0.5 ? ["new", "old"] : ["old", "new"];
    key.cases.push({ case: n, title: c.title, A, B });
    parts.push(
      "",
      `## Case ${n}: ${c.title}`,
      "",
      `Asked: ${c.request}`,
      "",
      "### A",
      "",
      shown(c.outputs[A]),
      "",
      "### B",
      "",
      shown(c.outputs[B]),
      "",
      answerLine(n),
    );
  });
  return { sheet: parts.join("\n") + "\n", key };
}

export interface Tally {
  new: number;
  old: number;
  same: number;
  unanswered: number[];
}

/** Count the rater's answers per arm. */
export function tally(sheet: string, key: RatingKey): Tally {
  const out: Tally = { new: 0, old: 0, same: 0, unanswered: [] };
  for (const c of key.cases) {
    const line = sheet.split("\n").find((l) => l.startsWith(answerLine(c.case)));
    const answer = line?.slice(answerLine(c.case).length).trim().toLowerCase();
    if (answer === "a") out[c.A]++;
    else if (answer === "b") out[c.B]++;
    else if (answer === "same") out.same++;
    else out.unanswered.push(c.case);
  }
  return out;
}

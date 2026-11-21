// Tally a filled-in rate.md against its key: `pnpm eval:reveal <results dir>`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tally } from "./rate.ts";
import type { RatingKey } from "./rate.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm eval:reveal <results directory>");
  process.exit(2);
}
const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as RatingKey;
const result = tally(readFileSync(join(dir, "rate.md"), "utf8"), key);
for (const c of key.cases) console.log(`case ${c.case} (${c.title}): A = ${c.A}, B = ${c.B}`);
console.log(`more readable: new ${result.new}, old ${result.old}, same ${result.same}`);
if (result.unanswered.length) console.log(`unanswered cases: ${result.unanswered.join(", ")}`);

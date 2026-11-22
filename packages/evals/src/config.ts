import { join } from "node:path";
import { DEFAULT_MATERIAL } from "./material";
import { PACKAGE } from "./paths";

export interface EvalConfig {
  model: string;
  runs: number;
  /** Fix rounds after the first attempt. */
  cap: number;
  concurrency: number;
  timeoutMs: number;
  /** A material directory, or a PRD file inside one. */
  material: string;
  resultsDir: string;
}

function count(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be a whole number of at least ${min}, not "${raw}"`);
  }
  return n;
}

/** The eval's settings from WIREDOWN_EVAL_* variables. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): EvalConfig {
  return {
    model: env.WIREDOWN_EVAL_MODEL || "sonnet",
    runs: count(env, "WIREDOWN_EVAL_RUNS", 2, 1),
    cap: count(env, "WIREDOWN_EVAL_CAP", 3, 0),
    concurrency: count(env, "WIREDOWN_EVAL_CONCURRENCY", 2, 1),
    timeoutMs: count(env, "WIREDOWN_EVAL_TIMEOUT_MS", 300_000, 1000),
    material: env.WIREDOWN_EVAL_PRD || DEFAULT_MATERIAL,
    resultsDir: env.WIREDOWN_EVAL_RESULTS || join(PACKAGE, "results"),
  };
}

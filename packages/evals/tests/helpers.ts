import { spawnSync } from "node:child_process";
import { BASELINE_SHA } from "../src/baseline.ts";
import { REPO } from "../src/paths.ts";

/**
 * Whether this clone has the baseline commit. CI checks out one commit
 * (fetch-depth 1), so the baseline tests skip there; locally they run.
 */
export const hasBaseline =
  spawnSync("git", ["cat-file", "-e", `${BASELINE_SHA}^{commit}`], { cwd: REPO }).status === 0;

export const screen = (id: string, body: string[], heading = id) =>
  [`## ${heading}`, "", "```wiredown", ...body, "```", "", `^${id}`, ""].join("\n");

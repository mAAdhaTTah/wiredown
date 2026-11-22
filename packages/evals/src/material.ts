import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PACKAGE } from "./paths";

/**
 * What the tasks are built from. A material directory holds `material.json`,
 * the PRD it names, and the input files of tasks 2 and 3: `variant-base.md`
 * and `review.md`.
 */
export interface Material {
  dir: string;
  prdPath: string;
  prd: string;
  /** Task 1: the screens to write, with the ids to use. */
  screens: { id: string; title: string }[];
  /** Task 2: a variant of `base`, with the id `id`. */
  variant: { base: string; id: string; change: string };
  /** Task 3: a reviewer comment on a screen of `review.md`. */
  review: { screen: string; comment: string };
  /** Task 2's screens file. */
  variantBase: string;
  /** Task 3's screens file. */
  reviewInput: string;
}

export const DEFAULT_MATERIAL = join(PACKAGE, "fixtures");

/**
 * Load the material from a directory, or from the directory of a PRD file
 * (`WIREDOWN_EVAL_PRD`). A PRD file given directly replaces the one
 * `material.json` names.
 */
export function loadMaterial(path = DEFAULT_MATERIAL): Material {
  const full = resolve(path);
  const isFile = statSync(full).isFile();
  const dir = isFile ? dirname(full) : full;
  const json = JSON.parse(readFileSync(join(dir, "material.json"), "utf8")) as Omit<
    Material,
    "dir" | "prdPath" | "prd" | "variantBase" | "reviewInput"
  > & { prd: string };
  const prdPath = isFile ? full : join(dir, json.prd);
  const read = (file: string) => readFileSync(join(dir, file), "utf8");
  return {
    dir,
    prdPath,
    prd: readFileSync(prdPath, "utf8"),
    screens: json.screens,
    variant: json.variant,
    review: json.review,
    variantBase: read("variant-base.md"),
    reviewInput: read("review.md"),
  };
}

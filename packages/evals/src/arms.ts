import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkScreens } from "@wiredown/core";
import type { SpecNode } from "@wiredown/core";
import { checkScreensInternal } from "../../core/dist/internal.js";
import { loadBaseline } from "./baseline.ts";
import type { BaselineCore } from "./baseline.ts";
import { PACKAGE, REPO } from "./paths.ts";

export type ArmName = "old" | "new";
export const ARMS: ArmName[] = ["new", "old"];

export interface Diagnostic {
  line: number;
  message: string;
  screen?: string;
}

export interface Report {
  /** Block ids found in the file, in order. */
  ids: (string | undefined)[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface Arm {
  name: ArmName;
  /** The syntax reference given to the model. */
  reference: string;
  check(markdown: string): Report;
}

/** Drop a leading HTML comment (a generated-file or licence note) from a reference. */
export const referenceText = (markdown: string) =>
  markdown.replace(/^\s*<!--[\s\S]*?-->\s*/, "").trimEnd() + "\n";

const SKILL_REFERENCE = join(REPO, "skills/wiredown/reference");
/** The skill's syntax reference as one document: the grammar, then each component category. */
export const newReference = () =>
  [
    join(SKILL_REFERENCE, "syntax.md"),
    ...readdirSync(join(SKILL_REFERENCE, "components"))
      .sort()
      .map((file) => join(SKILL_REFERENCE, "components", file)),
  ]
    .map((file) => referenceText(readFileSync(file, "utf8")).trim())
    .join("\n\n");
export const OLD_REFERENCE = join(PACKAGE, "fixtures/old/syntax.md");

/** The current parser and the skill's syntax reference. */
export function newArm(): Arm {
  return {
    name: "new",
    reference: newReference(),
    check(markdown) {
      const { screens, errors, warnings } = checkScreens(markdown);
      return { ids: screens.map((s) => s.id), errors, warnings };
    },
  };
}

/**
 * The baseline has no `checkScreens`, so run the current one with the
 * baseline's `resolve` as its block checker: scanning, `^id` handling and
 * every file-level finding (no id, invalid or duplicate id, unclosed fence)
 * are then the same code in both arms, and only the block parser differs.
 */
export function checkWithBaseline(core: BaselineCore, markdown: string): Report {
  const { screens, errors, warnings } = checkScreensInternal(markdown, (source, options) => {
    const { tree, errors } = core.resolve(source, options);
    // the baseline's tree is not checked or drawn, only carried along
    return { tree: tree as unknown as SpecNode, errors, warnings: [] };
  });
  return { ids: screens.map((s) => s.id), errors, warnings };
}

/** The baseline parser and the vendored prototype syntax reference. */
export async function oldArm(): Promise<Arm> {
  const core = await loadBaseline();
  return {
    name: "old",
    reference: referenceText(readFileSync(OLD_REFERENCE, "utf8")),
    check: (markdown) => checkWithBaseline(core, markdown),
  };
}

export async function loadArms(): Promise<Record<ArmName, Arm>> {
  return { new: newArm(), old: await oldArm() };
}

/** Findings as `wiredown check` prints them: `path:line: ^id: error: message`, in line order. */
export function formatFindings(file: string, report: Report): string {
  return [
    ...report.errors.map((f) => ({ ...f, level: "error" })),
    ...report.warnings.map((f) => ({ ...f, level: "warning" })),
  ]
    .sort((a, b) => a.line - b.line)
    .map(({ line, screen, level, message }) => {
      const what = screen !== undefined ? `^${screen}: ` : "";
      return `${file}:${line}: ${what}${level}: ${message}\n`;
    })
    .join("");
}

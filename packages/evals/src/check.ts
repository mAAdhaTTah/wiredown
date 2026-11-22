import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkScreens } from "@wiredown/core";
import { REPO } from "./paths";

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

/** Drop a leading HTML comment (the generated-file note) from a reference file. */
const withoutComment = (markdown: string) => markdown.replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim();

const SKILL_REFERENCE = join(REPO, "skills/wiredown/reference");

/** The skill's syntax reference as one document: the grammar, then each component category. */
export const skillReference = () =>
  [
    join(SKILL_REFERENCE, "syntax.md"),
    ...readdirSync(join(SKILL_REFERENCE, "components"))
      .sort()
      .map((file) => join(SKILL_REFERENCE, "components", file)),
  ]
    .map((file) => withoutComment(readFileSync(file, "utf8")))
    .join("\n\n") + "\n";

/** Check a screens file as `wiredown check` does. */
export function checkFile(markdown: string): Report {
  const { screens, errors, warnings } = checkScreens(markdown);
  return { ids: screens.map((s) => s.id), errors, warnings };
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

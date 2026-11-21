import { checkScreens } from "@wiredown/core";
import { formatFindings, json, plural, readSource } from "./output";
import type { Finding, Result } from "./output";

export interface CheckOptions {
  json?: boolean;
}

export interface CheckedFile {
  file: string;
  screens: { id?: string; heading?: string; line: number }[];
  errors: Finding[];
  warnings: Finding[];
}

/** One screens file's result, as `check` reports it. */
export function checkSource(file: string, source: string): CheckedFile {
  const { screens, errors, warnings } = checkScreens(source);
  const empty: Finding[] = screens.length ? [] : [{ message: "no wiredown blocks" }];
  return {
    file,
    screens: screens.map(({ id, heading, line }) => ({ id, heading, line })),
    errors,
    warnings: [...empty, ...warnings],
  };
}

/** Findings and a summary line per file. */
export function formatChecked(results: CheckedFile[]): string {
  return results
    .map(({ file, screens, errors, warnings }) => {
      const summary = [
        plural(screens.length, "screen"),
        plural(errors.length, "error"),
        plural(warnings.length, "warning"),
      ].join(", ");
      return formatFindings(file, errors, warnings) + `${file}: ${summary}\n`;
    })
    .join("");
}

/** Check each screens file; exit 1 if any has errors. Warnings don't fail. */
export async function check(files: string[], options: CheckOptions = {}): Promise<Result> {
  // read everything first, so an unreadable file leaves no partial output
  const sources = await Promise.all(files.map(readSource));
  const results = files.map((file, i) => checkSource(file, sources[i]));
  const exitCode = results.some((r) => r.errors.length) ? 1 : 0;
  if (options.json) return { exitCode, stdout: json({ files: results }), stderr: "" };
  return { exitCode, stdout: formatChecked(results), stderr: "" };
}

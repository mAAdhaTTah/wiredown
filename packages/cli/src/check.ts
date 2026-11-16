import { checkScreens } from "@wiredown/core";
import type { ScreenDiagnostic } from "@wiredown/core";
import { formatFindings, json, plural, readSource } from "./output.js";
import type { Result } from "./output.js";

export interface CheckOptions {
  json?: boolean;
}

export interface CheckedFile {
  file: string;
  screens: { id?: string; heading?: string; line: number }[];
  errors: ScreenDiagnostic[];
  warnings: ScreenDiagnostic[];
}

/** Check each screens file; exit 1 if any has errors. Warnings don't fail. */
export async function check(files: string[], options: CheckOptions = {}): Promise<Result> {
  // read everything first, so an unreadable file leaves no partial output
  const sources = await Promise.all(files.map(readSource));
  const results: CheckedFile[] = files.map((file, i) => {
    const { screens, errors, warnings } = checkScreens(sources[i]);
    return {
      file,
      screens: screens.map(({ id, heading, line }) => ({ id, heading, line })),
      errors,
      warnings,
    };
  });
  const exitCode = results.some((r) => r.errors.length) ? 1 : 0;
  if (options.json) return { exitCode, stdout: json({ files: results }), stderr: "" };
  const stdout = results
    .map(({ file, screens, errors, warnings }) => {
      const summary = [
        plural(screens.length, "screen"),
        plural(errors.length, "error"),
        plural(warnings.length, "warning"),
      ].join(", ");
      return formatFindings(file, errors, warnings) + `${file}: ${summary}\n`;
    })
    .join("");
  return { exitCode, stdout, stderr: "" };
}

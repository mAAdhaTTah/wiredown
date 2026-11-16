import { readFile } from "node:fs/promises";
import { nearest } from "@wiredown/core";
import type { ScreenDiagnostic } from "@wiredown/core";

/** What a command produced; the bin writes it out, tests inspect it. */
export interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * A finding; `line` is absent when it has no place in the file. Flow findings
 * name a `frame` and the `element` they are about instead.
 */
export type Finding = Omit<ScreenDiagnostic, "line"> & {
  line?: number;
  frame?: string;
  element?: string;
};

/** A failure before the command could produce a result: exit 2, nothing on stdout. */
export class UsageError extends Error {}

export async function readSource(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? String(error);
    throw new UsageError(`cannot read ${file}: ${reason}`);
  }
}

/** `path:line: ^id: error: message` (a flow's: `path: F2: error: message`), in line order. */
export function formatFindings(file: string, errors: Finding[], warnings: Finding[]): string {
  const all = [
    ...errors.map((f) => ({ ...f, level: "error" })),
    ...warnings.map((f) => ({ ...f, level: "warning" })),
  ].sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return all
    .map(({ line, screen, frame, level, message }) => {
      const where = line === undefined ? file : `${file}:${line}`;
      const what = frame !== undefined ? `${frame}: ` : screen !== undefined ? `^${screen}: ` : "";
      return `${where}: ${what}${level}: ${message}\n`;
    })
    .join("");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** Match render's unknown-screen wording across commands. */
export function unknownScreen(id: string, known: string[]): Finding {
  const guess = nearest(id, known);
  const list = known.length ? ` (it has ${known.map((k) => `^${k}`).join(", ")})` : "";
  const hint = guess ? `; did you mean "^${guess}"?` : "";
  return { message: `no screen "^${id}"${list}${hint}`, screen: id };
}

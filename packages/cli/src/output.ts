import { readFile } from "node:fs/promises";
import { nearest } from "@wiredown/core";
import type { ScreenDiagnostic } from "@wiredown/core";

/** What a command produced; the bin writes it out, tests inspect it. */
export interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A finding; `line` is absent when it has no place in the file. */
export type Finding = Omit<ScreenDiagnostic, "line"> & { line?: number };

/** A failure before the command could produce a result: exit 2, nothing on stdout. */
export class UsageError extends Error {}

/** A file or input problem a command reports with exit 1; any other error is a bug. */
export class CommandError extends Error {}

const REASONS: Record<string, string> = {
  ENOENT: "it does not exist",
  EACCES: "permission denied",
  EPERM: "permission denied",
  EISDIR: "it is a folder",
  ENOTDIR: "a folder in its path is a file",
  EEXIST: "it already exists",
};

/**
 * Runs a file operation; a file system error becomes a `CommandError`
 * reading `<what>: <reason>`, such as `cannot read a.md: it does not exist`.
 */
export async function fileOp<T>(what: string, op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !/^E[A-Z]+$/.test(code)) throw error;
    throw new CommandError(`${what}: ${REASONS[code] ?? code}`);
  }
}

export async function readSource(file: string): Promise<string> {
  try {
    return await fileOp(`cannot read ${file}`, readFile(file, "utf8"));
  } catch (error) {
    throw error instanceof CommandError ? new UsageError(error.message) : error;
  }
}

/** `path:line: ^id: error: message`, in line order. */
export function formatFindings(file: string, errors: Finding[], warnings: Finding[]): string {
  const all = [
    ...errors.map((f) => ({ ...f, level: "error" })),
    ...warnings.map((f) => ({ ...f, level: "warning" })),
  ].sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return all
    .map(({ line, screen, level, message }) => {
      const where = line === undefined ? file : `${file}:${line}`;
      return `${where}: ${screen !== undefined ? `^${screen}: ` : ""}${level}: ${message}\n`;
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkScreens, parseScreens } from "@wiredown/core";
import type { Screen } from "@wiredown/core";
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

export const NEW_REFERENCE = join(REPO, "skills/wiredown/reference/syntax.md");
export const OLD_REFERENCE = join(PACKAGE, "fixtures/old/syntax.md");

/** The current parser and the skill's syntax reference. */
export function newArm(): Arm {
  return {
    name: "new",
    reference: referenceText(readFileSync(NEW_REFERENCE, "utf8")),
    check(markdown) {
      const { screens, errors, warnings } = checkScreens(markdown);
      return { ids: screens.map((s) => s.id), errors, warnings };
    },
  };
}

/**
 * The baseline has no `checkScreens`: find the blocks and their `^ids` the
 * same way, then resolve each with a lookup across the file's blocks, so
 * both arms report per screen alike. Block-level findings (no id, a bad or
 * duplicate id) are reported at the block's opening fence.
 */
export function checkWithBaseline(core: BaselineCore, markdown: string): Report {
  let screens: Screen[];
  try {
    screens = parseScreens(markdown);
  } catch (error) {
    const m = /^line (\d+): (.*)$/.exec((error as Error).message);
    return {
      ids: [],
      errors: [{ line: m ? Number(m[1]) : 1, message: m ? m[2] : String(error) }],
      warnings: [],
    };
  }
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const byId = new Map<string, Screen>();
  for (const screen of screens) {
    const { id, line } = screen;
    if (id === undefined) {
      warnings.push({
        line: line - 1,
        message: "screen has no ^id; it can't be embedded in a flow",
      });
    } else if (!/^[A-Za-z0-9-]+$/.test(id)) {
      errors.push({ line: line - 1, message: `invalid block id "${id}"`, screen: id });
    } else if (byId.has(id)) {
      errors.push({ line: line - 1, message: `duplicate block id "${id}"`, screen: id });
    } else byId.set(id, screen);
  }
  for (const screen of screens) {
    const result = core.resolve(screen.source, {
      lookup: (id) => byId.get(id)?.source,
      known: () => [...byId.keys()],
    });
    for (const e of result.errors) {
      errors.push({
        line: screen.line + e.line - 1,
        message: e.message,
        ...(screen.id !== undefined ? { screen: screen.id } : {}),
      });
    }
  }
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

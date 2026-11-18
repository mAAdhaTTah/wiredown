import { check } from "./check";
import { closingFence, FENCE_KEYWORD } from "./detect";
import type { SpecNode } from "./types";
import { BLOCK_ID } from "./variants";

const ID = new RegExp(`^${BLOCK_ID.source}$`);

export interface Screen {
  id?: string;
  heading?: string;
  source: string;
  /** 1-based file line of the first content line. */
  line: number;
}

export interface ScreenDiagnostic {
  line: number;
  message: string;
  screen?: string;
}

export interface CheckedScreen extends Screen {
  tree: SpecNode;
}

export interface CheckScreensResult {
  screens: CheckedScreen[];
  errors: ScreenDiagnostic[];
  warnings: ScreenDiagnostic[];
}

function scan(markdown: string): {
  screens: Screen[];
  errors: ScreenDiagnostic[];
  idLines: number[];
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const screens: Screen[] = [];
  const errors: ScreenDiagnostic[] = [];
  const idLines: number[] = [];
  let heading: string | undefined;
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    // without a closing line it is not frontmatter, just a rule
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const title = /^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/.exec(lines[i]);
    if (title) heading = (title[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    // Setext headings, outside fences and frontmatter.
    if (i > start && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i]) && lines[i - 1].trim()) {
      heading = lines[i - 1].trim();
    }
    const open = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const close = closingFence(open[1]);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (end === lines.length) {
      errors.push({ line: i + 1, message: "unclosed code fence" });
      break;
    }
    if (open[2].trim().toLowerCase() === FENCE_KEYWORD) {
      let idLine = end + 1;
      if (lines[idLine] !== undefined && !lines[idLine].trim()) idLine++;
      const candidate = /^\^(.*)$/.exec(lines[idLine] ?? "");
      screens.push({
        ...(candidate ? { id: candidate[1].trim() } : {}),
        ...(heading !== undefined ? { heading } : {}),
        source: lines.slice(i + 1, end).join("\n"),
        line: i + 2,
      });
      idLines.push(idLine + 1);
    }
    i = end;
  }
  return { screens, errors, idLines };
}

/** Extract screens without normalizing content; malformed fences throw with a file line. */
export function parseScreens(markdown: string): Screen[] {
  const { screens, errors } = scan(markdown);
  if (errors.length) throw new Error(`line ${errors[0].line}: ${errors[0].message}`);
  return screens;
}

/** Check all blocks, resolving variants against the first valid occurrence of each id. */
export function checkScreens(markdown: string): CheckScreensResult {
  const { screens, errors, idLines } = scan(markdown);
  const warnings: ScreenDiagnostic[] = [];
  const byId = new Map<string, Screen>();
  screens.forEach((screen, i) => {
    const { id, line } = screen;
    if (id === undefined) {
      warnings.push({ line, message: "screen has no ^id; it can't be embedded in a flow" });
    } else if (!ID.test(id)) {
      errors.push({ line: idLines[i], message: `invalid block id "${id}"`, screen: id });
    } else {
      const first = byId.get(id);
      if (first) {
        errors.push({
          line: idLines[i],
          message: `duplicate block id "${id}"; first used on line ${idLines[screens.indexOf(first)]}`,
          screen: id,
        });
      } else byId.set(id, screen);
    }
  });
  const checked = screens.map((screen) => {
    const result = check(screen.source, {
      lookup: (id) => byId.get(id)?.source,
      known: () => [...byId.keys()],
      // a base's lines are file lines too
      lineOf: (id, line) => byId.get(id)!.line + line - 1,
    });
    const map = (diagnostic: { line: number; message: string }): ScreenDiagnostic => ({
      line: screen.line + diagnostic.line - 1,
      message: diagnostic.message,
      ...(screen.id !== undefined ? { screen: screen.id } : {}),
    });
    errors.push(...result.errors.map(map));
    warnings.push(...result.warnings.map(map));
    return { ...screen, tree: result.tree };
  });
  return { screens: checked, errors, warnings };
}

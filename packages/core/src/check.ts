import { RETIRED_OPTIONS, catalogEntry, optionsOf } from "./catalog.js";
import { gridRows } from "./components/grid.js";
import { ICON_NAMES, isIcon } from "./icons.js";
import { fontMeasurer } from "./metrics.js";
import { EXCALIFONT } from "./metrics-excalifont.js";
import { FLAGS, TRAILING, distance, parse, staysText } from "./parse.js";
import type { ParseError, ParseResult, SpecNode } from "./types.js";
import { resolve } from "./variants.js";
import type { ResolveOptions } from "./variants.js";

export interface CheckResult extends ParseResult {
  /** Things that draw, but probably not as meant. */
  warnings: ParseError[];
}

const excalifont = fontMeasurer(EXCALIFONT);
const FIELD_FLAGS = catalogEntry("field")!.flags;
/** Options before an id, as in "*Reserve (fill) #reserve"; the id ends the line instead. */
const LATE_ID = /(?<!\\)\(([^()]*)\)\s+(#[a-z][a-z0-9-]*)\s*$/;

/** Warnings for one source line. */
function lineWarnings(text: string): string[] {
  const out: string[] = [];
  // "{warnin}" is drawn as text; only a near miss of an icon name is likely a typo
  for (const [token, name] of text.matchAll(/\{([a-zA-Z-]+)\}/g)) {
    if (isIcon(name)) continue;
    const icon = ICON_NAMES.find((n) => distance(name.toLowerCase(), n) === 1);
    if (icon) out.push(`${token} is not an icon, so it is drawn as text; did you mean {${icon}}?`);
  }
  const chars = excalifont.unmeasured(text);
  if (chars.length) {
    const list = chars.map((c) => `"${c}"`).join(", ");
    const [is, it] = chars.length > 1 ? ["are", "them"] : ["is", "it"];
    out.push(
      `${list} ${is} not in Excalifont, so a fallback font draws ${it} at an estimated width`,
    );
  }
  return out;
}

/**
 * A warning for trailing brackets that stay text on a component's line but
 * look meant as options: they hold a retired option, or an option next to a
 * word that is none, as in "(striped, primry)", or they come before the id.
 * `type` and `takes` are the component's and the options it takes.
 */
function bracketWarning(text: string, type: string, takes: readonly string[]): string | null {
  const late = LATE_ID.exec(text);
  const m = late ?? TRAILING.exec(text);
  if (!m) return null;
  const entries = m[1].split(",").map((t) => t.trim());
  const brackets = `(${m[1]})`;
  if (late && !staysText(entries)) {
    const wrong = entries.filter((e) => {
      const [k, v] = e.split("=").map((t) => t.trim());
      return !takes.includes(k.toLowerCase()) || (v !== undefined && isNaN(Number(v)));
    });
    if (wrong.length) {
      const list = takes.length ? `it takes: ${takes.join(", ")}` : "it takes no options";
      return `"${brackets}" is drawn as text, and ${type} doesn't take ${wrong.map((e) => `"${e}"`).join(", ")} (${list})`;
    }
    const fixed = text.trim().replace(LATE_ID, "$2 ($1)");
    return `"${brackets}" is drawn as text; write the id before the options: "${fixed}"`;
  }
  if (!staysText(entries)) return null;
  const retired = entries.find((e) => RETIRED_OPTIONS.has(e.toLowerCase()));
  if (retired)
    return `"${brackets}" is drawn as text; ${RETIRED_OPTIONS.get(retired.toLowerCase())}`;
  if (!entries.some((e) => FLAGS.has(e.toLowerCase()))) return null;
  const others = entries.filter((e) => !FLAGS.has(e.toLowerCase()));
  const why =
    others.map((e) => `"${e}"`).join(", ") +
    (others.length > 1 ? " are not options" : " is not an option");
  return `"${brackets}" is drawn as text because ${why}; write \\( to keep the brackets as text`;
}

/** Warnings for the component lines of a block and the rows of its grids. */
function treeWarnings(lines: string[]): ParseError[] {
  const out: ParseError[] = [];
  const visit = (node: SpecNode, parent: SpecNode) => {
    node.children.forEach((child) => visit(child, node));
    const entry = catalogEntry(node.type);
    if (!node.line || !entry || entry.directive) return;
    // a field's component shares its line, so the field itself is skipped;
    // the component also takes the field's options
    const takes = [...optionsOf(entry), ...(parent.type === "field" ? FIELD_FLAGS : [])];
    const brackets =
      node.type === "field" ? null : bracketWarning(lines[node.line - 1], node.type, takes);
    if (brackets) out.push({ line: node.line, message: brackets });
    if (node.type !== "grid") return;
    // the line of each row: the grid's own, then its continuation lines, which skip comments
    const rowLines = [node.text, ...node.body].filter(Boolean);
    const at = node.text ? [node.line] : [];
    for (let i = node.line; at.length < rowLines.length; i++) {
      if (!lines[i].trim().startsWith("//")) at.push(i + 1);
    }
    const [header, ...rows] = gridRows(rowLines);
    for (const row of rows) {
      if (row.cells.length > header.cells.length) {
        out.push({
          line: at[row.index],
          message: `row has ${row.cells.length} cells but the header has ${header.cells.length}`,
        });
      }
    }
  };
  const root = parse(lines.join("\n")).tree;
  root.children.forEach((child) => visit(child, root));
  return out;
}

/**
 * Resolves a block as resolve() does, reports a block with nothing to draw,
 * and also warns about what draws but is probably a mistake: a misspelt
 * {icon}, characters Excalifont lacks, brackets that look like options but
 * are drawn as text (options before an id, too), and grid rows longer than
 * their header.
 */
export function check(source: string, options: ResolveOptions = {}): CheckResult {
  const { tree, errors } = resolve(source, options);
  const lines = source.replace(/\r/g, "").split("\n");
  if (lines.every((l) => !l.trim() || l.trim().startsWith("//"))) {
    errors.push({ line: 1, message: "the block is empty; write at least one component" });
  }
  const warnings = [
    ...treeWarnings(lines),
    ...lines.flatMap((text, i) =>
      text.trim().startsWith("//")
        ? []
        : lineWarnings(text).map((message) => ({ line: i + 1, message })),
    ),
  ].sort((a, b) => a.line - b.line);
  return { tree, errors, warnings };
}

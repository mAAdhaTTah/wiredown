import { CATALOG, catalogEntry, COMMON_FLAGS, optionsOf, RETIRED_OPTIONS } from "./catalog";
import { ICON_NAMES, isIcon } from "./icons";
import type { NodeType, ParseError, ParseResult, SpecNode } from "./types";

/** Keyword to node type; "field" is an input unless it has "Label | keyword:". */
const KEYWORDS = new Map<string, NodeType>(
  CATALOG.flatMap((e) =>
    e.keywords.map((k): [string, NodeType] => [k, e.type === "field" ? "input" : e.type]),
  ),
);
const FRAMES: NodeType[] = ["window", "dialog", "browser", "phone"];
const CONTAINERS = new Set<NodeType>([
  "root",
  "box",
  "form",
  "section",
  "tabs",
  "row",
  "columns",
  "after",
  "before",
  "replace",
  "extends",
  ...FRAMES,
]);
const BARE_OK = new Set<NodeType>([
  "grid",
  "tabs",
  "box",
  "form",
  "section",
  "row",
  "columns",
  ...FRAMES,
]); // may appear without a colon
const DIRECTIVES = new Set<NodeType>(["extends", "remove", "after", "before", "rows", "replace"]);
const CONTAINER_NAMES = [...CONTAINERS].filter((t) => t !== "root" && !DIRECTIVES.has(t));
// containers that take no continuation lines (tabs takes extra tab names)
const NO_BODY = new Set<NodeType>([...CONTAINERS].filter((t) => t !== "tabs"));

/** The error for a line that is neither a component nor a continuation line. */
function notUnderstood(line: string, keyword: string | undefined, type: NodeType | undefined) {
  const message = `don't understand "${line}"`;
  if (!keyword || !type || BARE_OK.has(type)) return message;
  const rest = line.slice(keyword.length).trim();
  return `${message}: "${keyword}" needs a colon, as in "${keyword}:${rest ? " " + rest : ""}"`;
}
/** Options a component has without writing them. */
const DEFAULT_OPTS: Partial<Record<NodeType, Record<string, number>>> = { buttons: { fill: 1 } };

/** Words that may stand alone in the options brackets; each sets its option to 1. */
export const FLAGS = new Set([...COMMON_FLAGS, ...CATALOG.flatMap((e) => e.flags)]);

/** Levenshtein distance, for "did you mean". */
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** The known word closest to a mistyped one, if it is close enough to be a typo. */
export function nearest(word: string, known: Iterable<string>): string | null {
  const w = word.toLowerCase();
  let best: string | null = null,
    bestD = Infinity;
  for (const k of known) {
    const d = distance(w, k);
    if (d < bestD) [best, bestD] = [k, d];
  }
  return bestD > 0 && bestD <= Math.max(1, Math.floor(w.length / 3)) ? best : null;
}

/** Brackets at the end of a line, unless escaped as "\(". */
export const TRAILING = /(?<!\\)\(([^()]*)\)\s*$/;

/** Option names some component reads; anything else in "(k=v)" is a likely typo. */
const OPTION_KEYS = new Set(CATALOG.flatMap((e) => e.numbers));

/**
 * Whether trailing brackets with these entries stay text: they have no k=v
 * pair and an entry that is neither a flag nor one letter off one.
 */
export function staysText(entries: string[]): boolean {
  return (
    !entries.some((e) => e.includes("=")) &&
    !entries.every((e) => FLAGS.has(e.toLowerCase()) || nearest(e, FLAGS))
  );
}

/** The error for an option no component takes, with a hint if it was retired. */
function unknownOption(name: string, guess: string | null): string {
  const retired = RETIRED_OPTIONS.get(name.toLowerCase());
  if (retired) return `"${name}" is not an option; ${retired}`;
  return `unknown option "${name}"${guess ? `; did you mean "${guess}"?` : ""}`;
}

/**
 * Reads "(k=v, flag, ...)" at the end of a line. Brackets with a k=v pair
 * are always options (pairs that aren't numeric are skipped, as in v2).
 * Brackets without one are options only if every entry is a known flag,
 * so "box: Title (optional)" keeps its text. "\(" keeps brackets as text,
 * as "\#" does an id. `takes`, the options of the component, come first
 * in "did you mean".
 */
export function parseOptions(
  s: string,
  takes: readonly string[] = [],
): {
  rest: string;
  opts: Record<string, number>;
  id?: string;
  /** Entries that were skipped, with why. */
  skipped?: string[];
} {
  const opts: Record<string, number> = {};
  let id: string | undefined;
  const skipped: string[] = [];
  const finish = (rest: string) => {
    const shorthand = /(?:^|\s)#([a-z][a-z0-9-]*)$/.exec(rest);
    if (shorthand) {
      if (id) skipped.push("use either #id or (id=...), not both");
      else id = shorthand[1];
      rest = rest.slice(0, shorthand.index).trimEnd();
    }
    return {
      rest: rest.replace(/\\([#(])/g, "$1"),
      opts,
      ...(id ? { id } : {}),
      ...(skipped.length ? { skipped } : {}),
    };
  };
  const m = s.match(TRAILING);
  if (!m || m.index === undefined) return finish(s.trim());
  const entries = m[1].split(",").map((t) => t.trim());
  // "(disbled)": every entry is a flag or one letter off, so it was meant as options
  if (staysText(entries)) return finish(s.trim());
  entries.forEach((entry) => {
    if (FLAGS.has(entry.toLowerCase())) {
      opts[entry.toLowerCase()] = 1;
      return;
    }
    const [k, v] = entry.split("=").map((t) => t.trim());
    if (k?.toLowerCase() === "id" && v) {
      if (/^[A-Za-z][\w-]*$/.test(v)) id = v;
      else skipped.push(`"${entry}": an id is a letter followed by letters, digits, - or _`);
    } else if (k && v && !isNaN(Number(v))) opts[k.toLowerCase()] = Number(v);
    else if (!entry.includes("=")) {
      skipped.push(unknownOption(entry, nearest(entry, takes) ?? nearest(entry, FLAGS)));
    } else skipped.push(`option "${entry}" needs a number, as in "${k}=200"`);
  });
  return finish(s.slice(0, m.index).trim());
}

const FIELD = catalogEntry("field")!;
/**
 * Options of a field's component that also apply to the field itself:
 * the field's own, and disabled, which greys the label too. (invalid) and
 * (focus) stay on the component, so they mark it and not the label.
 */
const FIELD_OPTS = [...FIELD.flags, "disabled"];

/**
 * Splits "Label | keyword: content" at the first | that is followed by a
 * keyword and a colon. Without one, "field:" stays an alias of input.
 */
function splitField(content: string): { label: string; line: string } | null {
  for (let i = content.indexOf("|"); i >= 0; i = content.indexOf("|", i + 1)) {
    const line = content.slice(i + 1).trim();
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*:/);
    if (m && KEYWORDS.has(m[1].toLowerCase())) return { label: content.slice(0, i).trim(), line };
  }
  return null;
}

/** The one-line form shown in notices: `line 3: don't understand "x"`. */
export function formatError(e: ParseError): string {
  return `line ${e.line}: ${e.message}`;
}

export function parse(source: string): ParseResult {
  const root: SpecNode = { type: "root", text: "", body: [], children: [], opts: {} };
  const errors: ParseError[] = [];
  const stack: { node: SpecNode; indent: number }[] = [{ node: root, indent: -1 }];
  let last: SpecNode | null = null; // most recent component, receives continuation lines
  source
    .replace(/\r/g, "")
    .split("\n")
    .forEach((raw, i) => {
      if (!raw.trim()) {
        last = null;
        return;
      }
      if (raw.trim().startsWith("//")) return; // a comment line
      const indent = (raw.match(/^[ \t]*/) ?? [""])[0].replace(/\t/g, "    ").length;
      const s = raw.trim();
      // "keyword: content", or a bare keyword optionally followed by options
      const m = s.match(
        /^([a-zA-Z][a-zA-Z0-9]*)\s*(?::\s*(.*)|((?:(?<=\s)#[a-z][a-z0-9-]*(?:\s+\([^()]*\))?|\([^()]*\))))?$/,
      );
      const type = m ? KEYWORDS.get(m[1].toLowerCase()) : undefined;
      const hasColon = /^[a-zA-Z][a-zA-Z0-9]*\s*:/.test(s);
      const bareOpts = m?.[3]
        ? parseOptions(m[3], type ? optionsOf(catalogEntry(type)!) : [])
        : null;
      const bareOk = !bareOpts || bareOpts.rest === "";
      if (m && type && (hasColon || (BARE_OK.has(type) && bareOk))) {
        while (stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack[stack.length - 1].node;
        if (!CONTAINERS.has(parent.type)) {
          errors.push({
            line: i + 1,
            message: `"${parent.type}" can't contain other components (only ${CONTAINER_NAMES.slice(0, -1).join(", ")} and ${CONTAINER_NAMES[CONTAINER_NAMES.length - 1]} can)`,
          });
          last = null;
          return;
        }
        /** Options a component takes; `extra` are more it takes (a field's). */
        const takesOf = (type: NodeType, extra: string[] = []) => {
          const own = optionsOf(catalogEntry(type)!);
          return [...own, ...extra.filter((k) => !own.includes(k))];
        };
        /** Errors for skipped options and for options the component doesn't take. */
        const optionErrors = (
          keyword: string,
          type: NodeType,
          parsed: ReturnType<typeof parseOptions>,
          extra: string[] = [],
          content?: string,
        ) => {
          for (const message of parsed.skipped ?? []) errors.push({ line: i + 1, message });
          const entry = catalogEntry(type)!;
          const takes = takesOf(type, extra);
          const keys = Object.keys(parsed.opts);
          const wrong = keys.filter((k) => !takes.includes(k));
          // flags it takes none of, after text: maybe meant as text
          const brackets = content && TRAILING.exec(content)?.[0].trim();
          const hint =
            brackets &&
            entry.content &&
            !entry.directive &&
            !brackets.includes("=") &&
            wrong.length === keys.length
              ? `; to keep "${brackets}" as text, write "\\${brackets}"`
              : "";
          for (const k of wrong) {
            let message: string;
            if (FLAGS.has(k) || OPTION_KEYS.has(k)) {
              const list = takes.length ? `it takes: ${takes.join(", ")}` : "it takes no options";
              message = `${keyword} doesn't take "${k}" (${list})${hint}`;
            } else {
              message = unknownOption(
                k,
                nearest(k, takes) ?? nearest(k, [...FLAGS, ...OPTION_KEYS]),
              );
            }
            errors.push({ line: i + 1, message });
          }
        };
        const component = (
          keyword: string,
          type: NodeType,
          content: string,
          extra: string[] = [],
        ): SpecNode => {
          const parsed = parseOptions(content, takesOf(type, extra));
          const { rest, opts, id } = parsed;
          optionErrors(keyword, type, parsed, extra, content);
          if (type === "icon" && !isIcon(rest)) {
            const guess = nearest(rest, ICON_NAMES);
            const hint = guess
              ? `did you mean "${guess}"?`
              : `known icons: ${ICON_NAMES.join(", ")}`;
            errors.push({ line: i + 1, message: `unknown icon "${rest}"; ${hint}` });
          }
          const node = { type, text: rest, body: [], children: [], line: i + 1 };
          return { ...node, opts: { ...DEFAULT_OPTS[type], ...opts }, ...(id ? { id } : {}) };
        };
        const keyword = m[1].toLowerCase();
        const labelled = keyword === "field" && hasColon ? splitField(m[2]) : null;
        let node: SpecNode;
        if (labelled) {
          // "field: Label | input: Anna": a label before one component
          const im = labelled.line.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(.*)$/)!;
          let innerKeyword = im[1].toLowerCase();
          let innerType = KEYWORDS.get(innerKeyword)!;
          let content = im[2];
          if (CONTAINERS.has(innerType)) {
            errors.push({
              line: i + 1,
              message: `a field holds one component like input or dropdown, not "${im[1]}"`,
            });
            innerKeyword = innerType = "input";
            content = "";
          }
          const inner = component(innerKeyword, innerType, content, FIELD.flags);
          const opts: Record<string, number> = {};
          for (const k of FIELD_OPTS) if (inner.opts[k]) opts[k] = inner.opts[k];
          node = {
            type: "field",
            text: labelled.label,
            body: [],
            children: [inner],
            opts,
            line: i + 1,
          };
          // the id names the whole field, label included
          if (inner.id) {
            node.id = inner.id;
            delete inner.id;
          }
        } else if (bareOpts) {
          node = {
            ...component(keyword, type, ""),
            opts: { ...DEFAULT_OPTS[type], ...bareOpts.opts },
          };
          if (bareOpts.id) node.id = bareOpts.id;
          optionErrors(keyword, type, bareOpts);
        } else {
          node = component(keyword, type, m[2] || "");
        }
        parent.children.push(node);
        stack.push({ node, indent });
        // continuation lines belong to a field's component
        last = node.type === "field" ? node.children[0] : node;
      } else if (m && !type && hasColon && nearest(m[1], KEYWORDS.keys())) {
        // "buton: Save" would otherwise be drawn as a line of the component above
        errors.push({
          line: i + 1,
          message: `unknown component "${m[1]}"; did you mean "${nearest(m[1], KEYWORDS.keys())}"?`,
        });
        last = null;
      } else if (last && !NO_BODY.has(last.type)) {
        // a tree's lines keep their indentation, which gives their level
        last.body.push(last.type === "tree" ? raw.replace(/\t/g, "    ").trimEnd() : s);
      } else {
        errors.push({ line: i + 1, message: notUnderstood(s, m?.[1], type) });
      }
    });
  const seen = new Map<string, number>();
  const checkIds = (node: SpecNode) => {
    if (node.id) {
      const first = seen.get(node.id);
      if (first !== undefined) {
        errors.push({
          line: node.line ?? 0,
          message: `the id "${node.id}" is used twice; first used on line ${first}`,
        });
      } else seen.set(node.id, node.line ?? 0);
    }
    node.children.forEach(checkIds);
  };
  checkIds(root);
  return { tree: root, errors };
}

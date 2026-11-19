import { parseCheck } from "./components/shared";
import { nearest, parse } from "./parse";
import type { ParseError, ParseResult, SpecNode } from "./types";

// A variant block draws another screen with a few changes:
//
//   extends: review-view
//   replace: notice                                              <- replaces the component with that id
//     alert: {check} Applied Bet 75% to 12 board(s).
//   remove: apply-row                                            <- removes one
//   after: boards                                                <- adds components after one (or before:)
//     text: -Rows without a result queue a task-
//   rows: boards                                                 <- changes rows of a grid
//     *[x] | 2c3c4c | = | = | = | Applied: Bet 75% | 0.04 | Bet 33%
//     remove 5d6h9s
//
// resolve() turns it into an ordinary tree before layout, so layout and the
// adapters never see a directive.

/** Finds the source of the screen with a block id; undefined when there is none. */
export type Lookup = (id: string) => string | undefined;

export interface ResolveOptions {
  lookup?: Lookup;
  /** Ids of every screen the host knows, for "did you mean". */
  known?: () => string[];
}

const DIRECTIVES = new Set(["extends", "remove", "after", "before", "rows", "replace"]);
const MAX_DEPTH = 8;

function firstLine(source: string): { text: string; line: number } | null {
  const lines = source.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s && !s.startsWith("//")) return { text: s, line: i + 1 };
  }
  return null;
}

/** The id a block extends, or null for an ordinary block. */
export function extendsId(source: string): string | null {
  const first = firstLine(source);
  const m = first && /^extends\s*:\s*\^?([A-Za-z][\w-]*)\s*$/i.exec(first.text);
  return m ? m[1] : null;
}

function walk(node: SpecNode, fn: (n: SpecNode, parent: SpecNode, index: number) => void): void {
  node.children.forEach((c, i) => {
    fn(c, node, i);
    walk(c, fn);
  });
}

function index(tree: SpecNode): Map<string, { parent: SpecNode; node: SpecNode }> {
  const ids = new Map<string, { parent: SpecNode; node: SpecNode }>();
  walk(tree, (node, parent) => {
    if (node.id) ids.set(node.id, { parent, node });
  });
  return ids;
}

/** Errors for directives outside a variant block, or inside another change of one. */
function check(tree: SpecNode, errors: ParseError[], variant: boolean): void {
  walk(tree, (node, parent) => {
    if (!DIRECTIVES.has(node.type)) return;
    const line = node.line ?? 0;
    if (!variant) {
      errors.push({
        line,
        message: `"${node.type}:" only works in a block whose first line is "extends: <screen id>"`,
      });
    } else if (parent !== tree && parent !== tree.children[0]) {
      errors.push({
        line,
        message: `"${node.type}:" can't go inside "${parent.type}:"; put it at the top level of the variant`,
      });
    }
  });
}

// ---------- grid rows ----------
const MARKS = /^[>*\s]*/;
const split = (row: string, pipe: boolean) =>
  (pipe ? row.replace(/^\|/, "").replace(/\|$/, "").split("|") : row.split(",")).map((c) =>
    c.trim(),
  );
/** A row's key: its first cell that is not a checkbox. */
function rowKey(row: string, pipe: boolean): string {
  const cells = split(row.replace(MARKS, ""), pipe);
  return cells.find((c) => c && !parseCheck(c)) ?? "";
}

function patchRows(grid: SpecNode, op: SpecNode, errors: ParseError[]): void {
  const rows = [grid.text, ...grid.body].filter(Boolean);
  const pipe = [...rows, ...op.body].some((r) => r.includes("|"));
  const sep = pipe ? " | " : ", ";
  const find = (key: string) => rows.findIndex((r, i) => i > 0 && rowKey(r, pipe) === key);
  const keys = () => rows.slice(1).map((r) => rowKey(r, pipe));
  op.body.forEach((patch, i) => {
    const line = (op.line ?? 0) + 1 + i;
    const removal = /^remove\s+(.+)$/i.exec(patch);
    if (removal && !patch.includes(pipe ? "|" : ",")) {
      const at = find(removal[1].trim());
      if (at < 0) {
        errors.push({
          line,
          message: `no row "${removal[1].trim()}" in the grid "${grid.id}"; its rows are: ${keys().join(", ")}`,
        });
      } else rows.splice(at, 1);
      return;
    }
    const marks = (MARKS.exec(patch) ?? [""])[0].replace(/\s/g, "");
    const cells = split(patch.replace(MARKS, ""), pipe);
    const key = cells.find((c) => c && c !== "=" && !parseCheck(c)) ?? "";
    const at = find(key);
    if (at < 0) {
      if (cells.includes("=")) {
        errors.push({
          line,
          message: `"=" keeps a cell of an existing row, but the grid "${grid.id}" has no row "${key}"; its rows are: ${keys().join(", ")}`,
        });
        return;
      }
      rows.push(marks + cells.join(sep));
      return;
    }
    const base = split(rows[at].replace(MARKS, ""), pipe);
    const merged = base.map((cell, ci) =>
      ci >= cells.length || cells[ci] === "=" ? cell : cells[ci],
    );
    rows[at] = marks + merged.concat(cells.slice(base.length)).join(sep);
  });
  grid.text = rows[0] ?? "";
  grid.body = rows.slice(1);
}

// ---------- resolution ----------
function resolveAt(source: string, o: ResolveOptions, chain: string[]): ParseResult {
  const { tree, errors } = parse(source);
  const baseId = extendsId(source);
  if (!baseId) {
    check(tree, errors, false);
    return { tree, errors };
  }
  const head = tree.children[0];
  const line = head?.line ?? 1;
  const fail = (message: string): ParseResult => ({
    tree: { ...tree, children: [] },
    errors: [...errors, { line, message }],
  });
  if (chain.includes(baseId) || chain.length >= MAX_DEPTH) {
    return fail(`extends: "${baseId}" extends itself (${[...chain, baseId].join(" → ")})`);
  }
  const baseSource = o.lookup?.(baseId);
  if (baseSource === undefined) {
    const known = o.known?.() ?? [];
    const guess = nearest(baseId, known);
    return fail(
      `extends: no screen with the id "${baseId}"` +
        (guess
          ? `; did you mean "${guess}"?`
          : known.length
            ? `; known ids: ${known.join(", ")}`
            : ""),
    );
  }
  const base = resolveAt(baseSource, o, [...chain, baseId]);
  for (const e of base.errors) {
    errors.push({ line, message: `in "${baseId}", line ${e.line}: ${e.message}` });
  }
  const out = base.tree;
  check(tree, errors, true);
  const known = () => [...index(out).keys()];
  const target = (id: string, at: number, what: string) => {
    const hit = index(out).get(id);
    if (hit) return hit;
    const guess = nearest(id, known());
    errors.push({
      line: at,
      message:
        `${what}: "${baseId}" has no component #${id}` +
        (guess ? `; did you mean "${guess}"?` : `; its ids are: ${known().join(", ") || "(none)"}`),
    });
    return null;
  };
  /** Errors for ids of added components that the screen already uses; a replaced component frees its own. */
  const clash = (added: SpecNode[], replaced?: SpecNode) => {
    const taken = index(out);
    const freed = replaced ? new Set([replaced.id, ...index(replaced).keys()]) : new Set();
    const one = (node: SpecNode) => {
      if (node.id && taken.has(node.id) && !freed.has(node.id)) {
        errors.push({
          line: node.line ?? 0,
          message: `the id "${node.id}" is already used in "${baseId}"`,
        });
      }
    };
    added.forEach((node) => {
      one(node);
      walk(node, one);
    });
  };
  // changes may be indented under "extends:" or follow it at the same level
  for (const op of [...head.children, ...tree.children.slice(1)]) {
    const at = op.line ?? 0;
    switch (op.type) {
      case "extends":
        errors.push({ line: at, message: `"extends:" must be the first line, and only once` });
        break;
      case "remove":
        for (const id of op.text
          .split(",")
          .map((t) => t.trim().replace(/^\^/, ""))
          .filter(Boolean)) {
          const hit = target(id, at, "remove");
          if (hit) hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1);
        }
        break;
      case "after":
      case "before": {
        const hit = target(op.text.replace(/^\^/, ""), at, op.type);
        if (!hit) break;
        clash(op.children);
        const i = hit.parent.children.indexOf(hit.node) + (op.type === "after" ? 1 : 0);
        hit.parent.children.splice(i, 0, ...op.children);
        break;
      }
      case "rows": {
        const hit = target(op.text.replace(/^\^/, ""), at, "rows");
        if (!hit) break;
        if (hit.node.type !== "grid") {
          errors.push({
            line: at,
            message: `rows: "${op.text}" is a ${hit.node.type}, not a grid`,
          });
        } else patchRows(hit.node, op, errors);
        break;
      }
      case "replace": {
        const hit = target(op.text.replace(/^\^/, ""), at, "replace");
        if (!hit) break;
        if (op.children.length !== 1) {
          errors.push({
            line: at,
            message: `replace: "${hit.node.id}" needs exactly one component indented under it, not ${op.children.length}`,
          });
          break;
        }
        const [node] = op.children;
        clash([node], hit.node);
        // the replacement keeps the id, so later variants can still target it
        node.id ??= hit.node.id;
        // a container replaced by a bare line keeps its children: only its title or options change
        if (!node.children.length && node.type === hit.node.type) node.children = hit.node.children;
        hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1, node);
        break;
      }
      default: {
        const named = op.id && index(out).has(op.id) ? op.id : "<id>";
        errors.push({
          line: at,
          message: `"${op.type}:" in a variant needs a command: "replace: ${named}", "after: <id>" or "before: <id>"`,
        });
      }
    }
  }
  return { tree: out, errors };
}

/** Parses a block and, if it is a variant, applies it to the screen it extends. */
export function resolve(source: string, options: ResolveOptions = {}): ParseResult {
  return resolveAt(source, options, []);
}

// ---------- back to text ----------
function line(node: SpecNode): string {
  const opts = Object.entries(node.opts).map(([k, v]) => (v === 1 ? k : `${k}=${v}`));
  const shorthand = node.id && /^[a-z][a-z0-9-]*$/.test(node.id) ? `#${node.id}` : "";
  if (node.id && !shorthand) opts.push(`id=${node.id}`);
  if (node.type === "field" && node.children[0]) {
    const inner = node.children[0];
    return `field: ${node.text} | ${line({ ...inner, id: node.id, opts: { ...inner.opts, ...node.opts } })}`;
  }
  const text = [
    node.text.replace(/#/g, "\\#"),
    shorthand,
    opts.length ? `(${opts.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return text ? `${node.type}: ${text}` : node.type;
}

/** The tree as plain spec text: what a resolved variant amounts to. */
export function serialize(tree: SpecNode, indent = ""): string {
  const out: string[] = [];
  for (const node of tree.children) {
    out.push(indent + line(node));
    const body = node.type === "field" ? (node.children[0]?.body ?? []) : node.body;
    for (const b of body) out.push(indent + (node.type === "tree" ? b : b.trim()));
    if (node.type !== "field")
      out.push(
        ...serialize(node, indent + "  ")
          .split("\n")
          .filter(Boolean),
      );
  }
  return out.join("\n");
}
